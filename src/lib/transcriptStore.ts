import type { Speaker, TranscriptSegment } from "../types";
import { openRecordingDB, TRANSCRIPT_STORE, BY_SESSION_INDEX } from "./recordingStore";

/**
 * Reads and writes the `transcript` object store (D-42, D-43). Imports
 * `openRecordingDB` from `recordingStore.ts` rather than opening a second,
 * independent database connection of its own — a second connection opened
 * directly would race the upgrade path and risk a mismatched version.
 *
 * Store shape (Task 1's confirmed option A): one `transcript` store, keyed
 * `["sessionId", "seq"]` exactly like `chunks`, with a `bySession` index. A
 * LIVE-13 correction is a field on the segment record (`resolvedSpeaker`),
 * not a second store — see `05-02-PLAN.md` Task 1 for the full decision.
 */

/**
 * Writes one transcript segment and resolves only once its transaction
 * completes (D-41), mirroring `appendChunk`'s exact discipline: one record
 * per call, and a quota failure rejects with the same quota-specific copy —
 * a transcript is small, but a full disk is a full disk and the operator
 * deserves the same sentence. Takes the caller's own `db` handle so the
 * write is not delayed behind opening a connection.
 */
export async function appendSegment(db: IDBDatabase, segment: TranscriptSegment): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSCRIPT_STORE, "readwrite");
    tx.objectStore(TRANSCRIPT_STORE).put(segment);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const isQuotaError = tx.error?.name === "QuotaExceededError";
      reject(
        isQuotaError
          ? new Error(
              "This browser ran out of local storage space to save the recording. Free up space or shorten the interview, then try again. Your recording so far has been kept.",
            )
          : tx.error || new Error("Failed to save a transcript segment."),
      );
    };
  });
}

/**
 * Field-by-field validation of one transcript record read back from
 * storage — records are input, not trusted internal state, mirroring
 * `normaliseSessionRecord`/`listTagPresses` in `recordingStore.ts`. A record
 * failing any check returns `null` and is skipped, never thrown into the
 * live render.
 */
function validateSegmentRecord(raw: unknown): TranscriptSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return null;
  if (typeof record.seq !== "number") return null;
  if (typeof record.startMs !== "number") return null;
  if (typeof record.endMs !== "number") return null;
  if (typeof record.windowStartMs !== "number") return null;
  if (typeof record.text !== "string") return null;
  if (record.speaker !== "candidate" && record.speaker !== "interviewer") return null;
  if (
    record.resolvedSpeaker !== undefined &&
    record.resolvedSpeaker !== "candidate" &&
    record.resolvedSpeaker !== "interviewer"
  ) {
    return null;
  }

  const segment: TranscriptSegment = {
    sessionId: record.sessionId,
    seq: record.seq,
    startMs: record.startMs,
    endMs: record.endMs,
    speaker: record.speaker,
    text: record.text,
    windowStartMs: record.windowStartMs,
  };
  if (record.resolvedSpeaker === "candidate" || record.resolvedSpeaker === "interviewer") {
    segment.resolvedSpeaker = record.resolvedSpeaker;
  }
  return segment;
}

/**
 * Reads one session's transcript segments through the `bySession` index,
 * validating every record field by field and reporting how many were
 * skipped — so "three records were unreadable" can be said out loud rather
 * than disguised as a shorter transcript (T-05-03). Opens and closes its own
 * short-lived connection. Degrades to `{ segments: [], skippedCount: 0 }` on
 * any storage failure, matching this file's read-never-rejects discipline.
 * Returned segments are sorted ascending by `startMs` then `seq`.
 */
export async function readSegments(
  sessionId: string,
): Promise<{ segments: TranscriptSegment[]; skippedCount: number }> {
  try {
    const db = await openRecordingDB();
    const rawRecords = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(TRANSCRIPT_STORE, "readonly");
      const index = tx.objectStore(TRANSCRIPT_STORE).index(BY_SESSION_INDEX);
      const results: unknown[] = [];
      const req = index.openCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(results);
          return;
        }
        results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    db.close();

    const segments: TranscriptSegment[] = [];
    let skippedCount = 0;
    for (const raw of rawRecords) {
      const segment = validateSegmentRecord(raw);
      if (segment) segments.push(segment);
      else skippedCount++;
    }
    segments.sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
    return { segments, skippedCount };
  } catch {
    return { segments: [], skippedCount: 0 };
  }
}

/**
 * Convenience wrapper over `readSegments` for callers that only need the
 * segments themselves. Callers that render a transcript should prefer
 * `readSegments` directly so a partial read stays observable.
 */
export async function listSegments(sessionId: string): Promise<TranscriptSegment[]> {
  try {
    const { segments } = await readSegments(sessionId);
    return segments;
  } catch {
    return [];
  }
}

/**
 * One past the highest stored `seq` for a session, 0 when there is none —
 * mirrors `nextSeqFor` in `recordingStore.ts`. A resumed or re-entered
 * session continues numbering rather than overwriting at the same key.
 * Degrades to 0 on any failure.
 */
export async function nextSegmentSeq(sessionId: string): Promise<number> {
  try {
    const { segments } = await readSegments(sessionId);
    const maxSeq = segments.reduce((max, segment) => Math.max(max, segment.seq), -1);
    return maxSeq + 1;
  } catch {
    return 0;
  }
}

/**
 * Sets `resolvedSpeaker` on the named records in one read-write transaction,
 * leaving `speaker` and every other field untouched (D-49) — a correction
 * is a read-modify-write of the segment record, never a rewrite of the
 * tag-track history. Resolves only on `tx.oncomplete`. Opens its own
 * connection (the caller only has a `sessionId`) and always closes it, even
 * on failure.
 */
export async function applyResolvedSpeakers(
  sessionId: string,
  updates: { seq: number; resolvedSpeaker: Speaker }[],
): Promise<void> {
  const db = await openRecordingDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TRANSCRIPT_STORE, "readwrite");
      const store = tx.objectStore(TRANSCRIPT_STORE);
      for (const update of updates) {
        const getReq = store.get([sessionId, update.seq]);
        getReq.onsuccess = () => {
          const existing = getReq.result as TranscriptSegment | undefined;
          if (existing) store.put({ ...existing, resolvedSpeaker: update.resolvedSpeaker });
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to apply a speaker correction."));
    });
  } finally {
    db.close();
  }
}

/**
 * A count of one session's transcript segments through the `bySession`
 * index — for the retention gate (plan 05-05) and the downloads panel.
 * Degrades to 0 on any failure.
 */
export async function countSegments(sessionId: string): Promise<number> {
  try {
    const db = await openRecordingDB();
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(TRANSCRIPT_STORE, "readonly");
      const index = tx.objectStore(TRANSCRIPT_STORE).index(BY_SESSION_INDEX);
      const req = index.count(IDBKeyRange.only(sessionId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return count;
  } catch {
    return 0;
  }
}
