import type {
  Coverage,
  Exchange,
  FeedbackDocument,
  JdCoverageItem,
  ResumeConsistencyFinding,
  ScoreRow,
  SubAsk,
  TranscriptSegment,
} from "../types";
import { findQuoteInSegments } from "./quoteMatcher";

/**
 * The D-58 rollup derivations feeding the feedback surface's headline
 * sections: silent gaps (LIVE-17), missed follow-ups (LIVE-18), JD coverage
 * (LIVE-19), the D-69 resume-evidence gate, and the D-73 `ScoreRow`
 * derivation. Pure — touches no browser global — so
 * `scripts/check-tag-track.ts` can import and assert it under Node, the same
 * discipline `transcriptTurns.ts` and `quoteMatcher.ts` follow.
 *
 * `deriveSilentGaps` and `deriveMissedFollowUps` share one walk over
 * `SubAsk.source` (D-65's two-directional detection) rather than each
 * re-deriving the asked/implied classification independently: a sub-ask's
 * `source` can satisfy only one of the two predicates, so the two outputs
 * partition a FeedbackDocument's sub-asks by construction and can never
 * overlap.
 *
 * `filterEvidencedResumeFindings` gates every resume-consistency finding on
 * the same `findQuoteInSegments` primitive D-66 uses for sub-ask evidence
 * (D-69) — an unevidenced accusation about a person is worse than a missed
 * one, so a miss here drops the finding entirely rather than downgrading it,
 * unlike a sub-ask's evidence quote.
 *
 * `deriveScoreRow` reproduces `InterviewScoringTable.tsx:49-54`'s averaging
 * expression verbatim (see the `targetRow` naming below) rather than
 * re-deriving it, so a Tool-4-sourced row can never silently disagree with a
 * manually-edited one once Phase 7 wires the ledger.
 *
 * Every exported function is total: a malformed or empty input returns a
 * safe default, never a throw.
 */

/**
 * One asked sub-ask that went unanswered (LIVE-17) — the headline of the
 * assembled FeedbackDocument (D-58). Carries the same fields as
 * `MissedFollowUp` and is a distinct named type from it deliberately: "you
 * were asked this and did not answer it" and "the JD implies this and it
 * never came up" are different claims about a candidate, and the rendered
 * surface must never let one stand in for the other (D-65).
 */
export interface SilentGap {
  exchangeIndex: number;
  questionText: string;
  subAskText: string;
  coverage: Coverage;
}

/**
 * One implied sub-ask the interviewer never probed (LIVE-18) — the same
 * detection as `SilentGap`, read from the other direction (D-65).
 */
export interface MissedFollowUp {
  exchangeIndex: number;
  questionText: string;
  subAskText: string;
  coverage: Coverage;
}

/**
 * The shared walk both `deriveSilentGaps` and `deriveMissedFollowUps` run:
 * sort a shallow copy of `doc.exchanges` by `exchangeIndex`, then within each
 * exchange walk `subAsks` in their existing order, collecting every sub-ask
 * matching `source` whose `coverage` is not `"ADDRESSED"`. Never mutates
 * `doc`, any exchange, or any sub-ask.
 */
function collectUnaddressedBySource(
  doc: FeedbackDocument,
  source: SubAsk["source"],
): { exchangeIndex: number; questionText: string; subAskText: string; coverage: Coverage }[] {
  const exchanges: Exchange[] = Array.isArray(doc?.exchanges) ? doc.exchanges : [];
  const sorted = [...exchanges].sort((a, b) => a.exchangeIndex - b.exchangeIndex);
  const results: {
    exchangeIndex: number;
    questionText: string;
    subAskText: string;
    coverage: Coverage;
  }[] = [];
  for (const exchange of sorted) {
    for (const subAsk of exchange.subAsks) {
      if (subAsk.source === source && subAsk.coverage !== "ADDRESSED") {
        results.push({
          exchangeIndex: exchange.exchangeIndex,
          questionText: exchange.questionText,
          subAskText: subAsk.text,
          coverage: subAsk.coverage,
        });
      }
    }
  }
  return results;
}

/**
 * LIVE-17's headline: every sub-ask the interviewer actually asked
 * (`source: "asked"`) that the answer did not fully cover — `PARTIAL`,
 * `NOT_ADDRESSED`, and `DEFLECTED` are all gaps, because a half-answer is not
 * an answer. Ordered by `exchangeIndex` ascending, then by the sub-ask's
 * existing position within its exchange. `[]` for a FeedbackDocument with no
 * unanswered asked sub-asks, or with zero exchanges — both real answers the
 * rendered surface states a sentence for, never an absent section (D-58).
 */
export function deriveSilentGaps(doc: FeedbackDocument): SilentGap[] {
  return collectUnaddressedBySource(doc, "asked");
}

/**
 * LIVE-18: every sub-ask the job description implies but the interviewer
 * never asked out loud (`source: "implied_by_jd"`) that the answer did not
 * fully cover — the interviewer's opportunity missed, framed as feedback for
 * them rather than a question the candidate dodged (D-65). This is the same
 * detection `deriveSilentGaps` runs, read from the other direction: the two
 * predicates are mutually exclusive by construction on `source`, so no
 * sub-ask can ever appear in both this function's output and
 * `deriveSilentGaps`'s.
 */
export function deriveMissedFollowUps(doc: FeedbackDocument): MissedFollowUp[] {
  return collectUnaddressedBySource(doc, "implied_by_jd");
}

/**
 * LIVE-19: the job-description requirements nothing in the interview
 * evidenced — a set difference over what the JD asked for and what anything
 * the candidate said evidenced. Preserves the original array order. `[]`
 * when every requirement was evidenced, or the array is empty or absent.
 */
export function deriveJdCoverage(doc: FeedbackDocument): JdCoverageItem[] {
  const items: JdCoverageItem[] = Array.isArray(doc?.jdCoverage) ? doc.jdCoverage : [];
  return items.filter((item) => item && item.evidenced === false);
}

/**
 * D-69's gate on the most reputationally delicate output the feedback
 * surface renders: a resume-consistency finding is kept only when its
 * `resumeLine` is non-empty after trimming AND its `spokenQuote` passes the
 * same `findQuoteInSegments` verification D-66 uses for sub-ask evidence. A
 * miss on either side drops the finding entirely — never renders it, never
 * downgrades it — because an unevidenced accusation about a person is worse
 * than a missed one. A kept finding is returned as a new object carrying the
 * matcher's resolved `spokenSegmentSeq`/`spokenStartMs`; the input array and
 * its findings are never mutated.
 */
export function filterEvidencedResumeFindings(
  findings: ResumeConsistencyFinding[],
  segments: TranscriptSegment[],
): ResumeConsistencyFinding[] {
  const list: ResumeConsistencyFinding[] = Array.isArray(findings) ? findings : [];
  const results: ResumeConsistencyFinding[] = [];
  for (const finding of list) {
    if (!finding || typeof finding.resumeLine !== "string" || !finding.resumeLine.trim()) continue;
    const match = findQuoteInSegments(finding.spokenQuote, segments);
    if (!match.matched) continue;
    results.push({
      ...finding,
      spokenSegmentSeq: match.segmentSeq,
      spokenStartMs: match.startMs,
    });
  }
  return results;
}

/**
 * D-73: derives `starRating`/`competencyRating` from the seven raw
 * `ScoreRow` fields, reproducing `InterviewScoringTable.tsx:49-54`'s
 * expression verbatim — divisors, two-decimal fixing, and the `Number(...)`
 * wrapper included. The local `targetRow` name below is deliberate, not
 * cosmetic: it keeps this expression textually identical to
 * `InterviewScoringTable.tsx`'s own, which is what
 * `scripts/check-tag-track.ts`'s formula-parity guard (Task 2) statically
 * compares against. Those two averages are recomputed on every manual edit
 * there, so a Tool-4-sourced row carrying a differently-rounded value would
 * silently disagree with itself the moment a human touches the row in
 * Phase 7's ledger. Returns `null` — never a row of zeros — when any of the
 * seven fields is missing or not a finite number, which is what keeps an
 * exchange with no usable score from rendering as a grade of zero.
 */
export function deriveScoreRow(
  questionDescription: string,
  raw:
    | {
        s?: unknown;
        tE?: unknown;
        a?: unknown;
        rT?: unknown;
        cS?: unknown;
        aE?: unknown;
        rA?: unknown;
      }
    | undefined
    | null,
): ScoreRow | null {
  if (!raw || typeof raw !== "object") return null;

  const fields = [raw.s, raw.tE, raw.a, raw.rT, raw.cS, raw.aE, raw.rA];
  if (fields.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;

  const targetRow = {
    s: raw.s as number,
    tE: raw.tE as number,
    a: raw.a as number,
    rT: raw.rT as number,
    cS: raw.cS as number,
    aE: raw.aE as number,
    rA: raw.rA as number,
  };

  const starRating = Number(
    ((targetRow.s + targetRow.tE + targetRow.a + targetRow.rT) / 4).toFixed(2),
  );
  // check-tag-track.ts's D-73 parity guard compares this expression with its
  // twin as source text, so a formatter that wraps one site and not the other
  // breaks the build. Both are pinned to one line.
  // prettier-ignore
  const competencyRating = Number(((targetRow.cS + targetRow.aE + targetRow.rA) / 3).toFixed(2));

  return {
    questionDescription,
    s: targetRow.s,
    tE: targetRow.tE,
    a: targetRow.a,
    rT: targetRow.rT,
    starRating,
    cS: targetRow.cS,
    aE: targetRow.aE,
    rA: targetRow.rA,
    competencyRating,
  };
}
