import type {
  Coverage,
  Exchange,
  FeedbackDocument,
  JdCoverageItem,
  ResumeConsistencyFinding,
  SubAsk,
  SubAskSource,
} from "../types";
import { openRecordingDB, DOCUMENTS_STORE } from "./recordingStore";

/**
 * Reads and writes the `documents` object store (D-72). Imports
 * `openRecordingDB` from `recordingStore.ts` rather than opening a second,
 * independent database connection of its own — a second connection opened
 * directly would race the upgrade path and risk a mismatched version,
 * mirroring `transcriptStore.ts`'s exact discipline.
 *
 * Store shape (operator-confirmed, plan 06-03 Task 1): `documents` is keyed
 * directly by `sessionId`, no index — exactly one stored feedback document
 * per take, replaced wholesale on regeneration rather than accumulating a
 * history. A stored record is input, not trusted internal state (T-06-06):
 * it may have been written by an older build or hand-edited via devtools, so
 * every read validates field by field and degrades to `null`/`[]` on any
 * failure rather than throwing into the render.
 */

const KNOWN_COVERAGE_VALUES: readonly Coverage[] = [
  "ADDRESSED",
  "PARTIAL",
  "NOT_ADDRESSED",
  "DEFLECTED",
];

/**
 * Field-by-field validation of one sub-ask entry inside a stored exchange. A
 * record failing any of the three load-bearing checks (`text`, `coverage`,
 * `quoteUnverified`) returns `null` and is dropped from its exchange's
 * `subAsks` array rather than failing the whole document — matches
 * `validateSegmentRecord`'s per-member discipline in `transcriptStore.ts`.
 * Every other field defaults to a safe value rather than causing a drop,
 * since none of them independently determine whether this sub-ask can be
 * rendered at all.
 */
function validateSubAsk(raw: unknown): SubAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.text !== "string") return null;
  if (
    typeof record.coverage !== "string" ||
    !(KNOWN_COVERAGE_VALUES as readonly string[]).includes(record.coverage)
  ) {
    return null;
  }
  if (typeof record.quoteUnverified !== "boolean") return null;

  const source: SubAskSource = record.source === "implied_by_jd" ? "implied_by_jd" : "asked";
  const subAsk: SubAsk = {
    text: record.text,
    source,
    coverage: record.coverage as Coverage,
    evidenceQuote: typeof record.evidenceQuote === "string" ? record.evidenceQuote : "",
    quoteUnverified: record.quoteUnverified,
    assessment: typeof record.assessment === "string" ? record.assessment : "",
    whatAGoodAnswerWouldHaveIncluded:
      typeof record.whatAGoodAnswerWouldHaveIncluded === "string"
        ? record.whatAGoodAnswerWouldHaveIncluded
        : "",
  };
  if (typeof record.evidenceSegmentSeq === "number")
    subAsk.evidenceSegmentSeq = record.evidenceSegmentSeq;
  if (typeof record.evidenceStartMs === "number") subAsk.evidenceStartMs = record.evidenceStartMs;
  return subAsk;
}

/**
 * Field-by-field validation of one exchange. Drops a malformed member rather
 * than failing the whole document. An exchange needs a numeric
 * `exchangeIndex`, a string `questionText`, and an array `subAsks` — every
 * other field defaults safely. An exchange whose `subAsks` validates to
 * empty is still a valid exchange.
 */
function validateExchange(raw: unknown): Exchange | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.exchangeIndex !== "number") return null;
  if (typeof record.questionText !== "string") return null;
  if (!Array.isArray(record.subAsks)) return null;

  const subAsks: SubAsk[] = [];
  for (const rawSubAsk of record.subAsks) {
    const subAsk = validateSubAsk(rawSubAsk);
    if (subAsk) subAsks.push(subAsk);
  }

  const exchange: Exchange = {
    exchangeIndex: record.exchangeIndex,
    questionText: record.questionText,
    questionIntent: typeof record.questionIntent === "string" ? record.questionIntent : "",
    answerText: typeof record.answerText === "string" ? record.answerText : "",
    subAsks,
    starApplicable: record.starApplicable === true,
    starNote: typeof record.starNote === "string" ? record.starNote : "",
  };
  if (typeof record.startMs === "number") exchange.startMs = record.startMs;
  if (typeof record.endMs === "number") exchange.endMs = record.endMs;

  if (record.scoreRow && typeof record.scoreRow === "object") {
    const scoreRowCandidate = record.scoreRow as Record<string, unknown>;
    const numericFields = [
      "s",
      "tE",
      "a",
      "rT",
      "starRating",
      "cS",
      "aE",
      "rA",
      "competencyRating",
    ] as const;
    const isValidScoreRow =
      typeof scoreRowCandidate.questionDescription === "string" &&
      numericFields.every((field) => typeof scoreRowCandidate[field] === "number");
    if (isValidScoreRow) {
      exchange.scoreRow = {
        questionDescription: scoreRowCandidate.questionDescription as string,
        s: scoreRowCandidate.s as number,
        tE: scoreRowCandidate.tE as number,
        a: scoreRowCandidate.a as number,
        rT: scoreRowCandidate.rT as number,
        starRating: scoreRowCandidate.starRating as number,
        cS: scoreRowCandidate.cS as number,
        aE: scoreRowCandidate.aE as number,
        rA: scoreRowCandidate.rA as number,
        competencyRating: scoreRowCandidate.competencyRating as number,
      };
    }
    // An invalid scoreRow is dropped, not the whole exchange — Phase 7's
    // ledger wiring only reads `scoreRow` when present.
  }
  return exchange;
}

/**
 * Field-by-field validation of one resume-consistency finding. D-69's rule
 * applies on read as well as on write: a record written by an older build
 * that lacks one side of the quoted pair is not renderable, so both
 * `spokenQuote` and `resumeLine` must be non-empty strings or the finding is
 * dropped.
 */
function validateResumeConsistencyFinding(raw: unknown): ResumeConsistencyFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.spokenQuote !== "string" || record.spokenQuote.trim().length === 0) return null;
  if (typeof record.resumeLine !== "string" || record.resumeLine.trim().length === 0) return null;

  const finding: ResumeConsistencyFinding = {
    spokenQuote: record.spokenQuote,
    resumeLine: record.resumeLine,
    note: typeof record.note === "string" ? record.note : "",
  };
  if (typeof record.spokenSegmentSeq === "number")
    finding.spokenSegmentSeq = record.spokenSegmentSeq;
  if (typeof record.spokenStartMs === "number") finding.spokenStartMs = record.spokenStartMs;
  return finding;
}

/** Field-by-field validation of one JD-coverage item. Needs a non-empty `requirement`. */
function validateJdCoverageItem(raw: unknown): JdCoverageItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.requirement !== "string" || record.requirement.trim().length === 0) return null;
  return { requirement: record.requirement, evidenced: record.evidenced === true };
}

/**
 * Field-by-field validation of one `documents` record read back from
 * storage — records are input, not trusted internal state (T-06-06),
 * mirroring `validateSegmentRecord` in `transcriptStore.ts`. A record failing
 * any check returns `null` and the take reverts to un-analysed rather than
 * throwing into the render. A document whose `exchanges` array validates to
 * empty is still a valid document — Structure legitimately finds no
 * substantive questions in some takes.
 */
function validateFeedbackRecord(raw: unknown): FeedbackDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return null;
  if (typeof record.generatedAt !== "number") return null;
  if (typeof record.withheldRemarkCount !== "number") return null;
  if (typeof record.transcriptFingerprint !== "string") return null;
  if (typeof record.strengths !== "string") return null;
  if (typeof record.priorityImprovements !== "string") return null;
  if (!Array.isArray(record.exchanges)) return null;
  if (!Array.isArray(record.resumeConsistency)) return null;
  if (!Array.isArray(record.jdCoverage)) return null;

  const exchanges: Exchange[] = [];
  for (const rawExchange of record.exchanges) {
    const exchange = validateExchange(rawExchange);
    if (exchange) exchanges.push(exchange);
  }
  const resumeConsistency: ResumeConsistencyFinding[] = [];
  for (const rawFinding of record.resumeConsistency) {
    const finding = validateResumeConsistencyFinding(rawFinding);
    if (finding) resumeConsistency.push(finding);
  }
  const jdCoverage: JdCoverageItem[] = [];
  for (const rawItem of record.jdCoverage) {
    const item = validateJdCoverageItem(rawItem);
    if (item) jdCoverage.push(item);
  }

  const document: FeedbackDocument = {
    sessionId: record.sessionId,
    generatedAt: record.generatedAt,
    transcriptFingerprint: record.transcriptFingerprint,
    exchanges,
    resumeConsistency,
    jdCoverage,
    strengths: record.strengths,
    priorityImprovements: record.priorityImprovements,
    withheldRemarkCount: record.withheldRemarkCount,
  };
  if (typeof record.modelUsed === "string") document.modelUsed = record.modelUsed;
  if (typeof record.provider === "string") document.provider = record.provider;
  return document;
}

/**
 * Writes one feedback document, replacing whatever was stored for this
 * `sessionId` wholesale (D-72 — a regeneration is a `put`, never an append).
 * Opens its own short-lived connection, `put`s the record, closes, and
 * resolves only once the transaction completes — mirroring `appendSegment`'s
 * discipline in `transcriptStore.ts`, including its quota-specific error
 * copy, adapted here for a feedback document rather than a recording chunk.
 */
export async function putFeedbackDocument(document: FeedbackDocument): Promise<void> {
  const db = await openRecordingDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DOCUMENTS_STORE, "readwrite");
      tx.objectStore(DOCUMENTS_STORE).put(document);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        const isQuotaError = tx.error?.name === "QuotaExceededError";
        reject(
          isQuotaError
            ? new Error(
                "This browser ran out of local storage space to save the feedback document. Free up space, then try again — the document on screen has not been lost.",
              )
            : tx.error || new Error("Failed to save the feedback document."),
        );
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Reads one take's stored feedback document by `sessionId`, validates it,
 * and resolves `null` on any storage failure or validation failure —
 * mirroring `readSegments`'s try/catch-to-safe-default shape. Resolves; it
 * never rejects, so a stored-shape mismatch degrades the take to
 * un-analysed rather than throwing into the render.
 */
export async function readFeedbackDocument(sessionId: string): Promise<FeedbackDocument | null> {
  try {
    const db = await openRecordingDB();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(DOCUMENTS_STORE, "readonly");
      const req = tx.objectStore(DOCUMENTS_STORE).get(sessionId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return validateFeedbackRecord(raw);
  } catch {
    return null;
  }
}

/**
 * The `sessionId` of every take with a stored feedback document — reads the
 * store's key list only, never the records themselves, so the takes list can
 * mark which takes are already analysed without reading (and validating)
 * every document. Degrades to `[]` on any failure.
 */
export async function listAnalysedSessionIds(): Promise<string[]> {
  try {
    const db = await openRecordingDB();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(DOCUMENTS_STORE, "readonly");
      const req = tx.objectStore(DOCUMENTS_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return keys.filter((key): key is string => typeof key === "string");
  } catch {
    return [];
  }
}
