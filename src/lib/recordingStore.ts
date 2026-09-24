import type {
  AudioChunkMeta,
  AudioChunkRecord,
  RecordingSession,
  RecordingSummary,
  Speaker,
  TagPress,
  TagSpan,
  TranscriptStatus,
} from "../types";

/**
 * Every chunk is written as its own IndexedDB record rather than appended
 * into a growing `Blob` — incremental blob-append rewrites the whole
 * accumulated blob on every write, which is quadratic over a long interview.
 *
 * Schema: database `live_interview_recordings` at version 4, with store
 * `sessions` (keyPath `sessionId`), store `chunks` (keyPath
 * `["sessionId", "seq"]`, index `bySession` on `sessionId`), store `tags`
 * (`autoIncrement` key, index `bySession` on `sessionId`), store
 * `transcript` (keyPath `["sessionId", "seq"]`, index `bySession` on
 * `sessionId` — added at version 3, D-42), and store `documents` (keyPath
 * `sessionId`, no index — added at version 4, D-72). Version 2 is a
 * one-way, non-migrating upgrade (D-28): `onupgradeneeded` drops and
 * recreates `sessions` and `chunks` rather than reading version-1 records
 * forward, because a version-1 session holds two interleaved chunk
 * sequences this reader cannot assemble into one file and the `chunks`
 * keyPath itself changes shape. Version 3 is a deliberate departure from
 * that precedent (D-43): a v2 take is fully readable (audio plus tag
 * track), so the v3 branch only adds the new `transcript` store and
 * touches `sessions`, `chunks` and `tags` not at all. Version 4 follows
 * the version-3 precedent, not the version-2 one: every version-3 take is
 * fully readable, so the v4 branch only creates the new `documents` store
 * — one stored feedback document per take, keyed directly by `sessionId`
 * and replaced wholesale on regeneration (D-72) — and touches `sessions`,
 * `chunks`, `tags` and `transcript` not at all. A version-3 take simply
 * has no feedback document, which the takes list renders honestly rather
 * than a state this upgrade needs to prevent. See the `onupgradeneeded`
 * handler below for the reasoning in full. Every read path here degrades
 * to a safe empty default on failure rather than throwing into the UI,
 * mirroring `loadContext`'s try/catch discipline in `src/App.tsx`.
 */

export const DB_NAME = "live_interview_recordings";
export const DB_VERSION = 4;

const SESSIONS_STORE = "sessions";
const CHUNKS_STORE = "chunks";
const TAGS_STORE = "tags";
export const TRANSCRIPT_STORE = "transcript";
export const DOCUMENTS_STORE = "documents";
export const BY_SESSION_INDEX = "bySession";

/**
 * Every connection this app opens, except the one call site that opts out.
 * `deleteDatabase()` (D-12) dispatches a `versionchange` event to every open
 * connection that hasn't already closed; a connection that never reacts to it
 * leaves the delete request queued behind `onblocked` until this tab reloads
 * and the browser tears every connection down for it — which is exactly the
 * "Clear stored data works, but only after a reload" defect (LIVE-09). The
 * short-lived helper connections below (`listStoppedSessions`,
 * `hasStoredRecordings`, `assembleSessionBlob`, etc.) already close
 * themselves the moment their one read or write finishes, but any of them
 * that failed to reach that `close()` call on some untraced error path stays
 * open indefinitely with nothing left holding a reference to close it later
 * — this handler is what still lets `deleteDatabase()` get past it.
 *
 * `handleBegin` in `LiveInterview` opts out (`autoCloseOnVersionChange:
 * false`) for the one connection this app *deliberately* keeps open across
 * awaits — the active recording's own handle. Auto-closing that one on any
 * `versionchange` would silently cut off a live take's storage mid-recording
 * the moment "Clear stored data" is clicked, rather than the honest
 * `"blocked"` outcome `deleteRecordingDB` reports while a take is genuinely
 * still in progress.
 */
export function openRecordingDB(options?: {
  autoCloseOnVersionChange?: boolean;
}): Promise<IDBDatabase> {
  const autoCloseOnVersionChange = options?.autoCloseOnVersionChange ?? true;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 2) {
        // One-way wipe, not a migration (D-28): a version-1 session holds two
        // interleaved chunk sequences that cannot be assembled into one
        // in-room file, and the chunks keyPath itself drops the per-stream
        // segment, so version-1 records cannot be read back under this
        // store definition regardless.
        if (db.objectStoreNames.contains(SESSIONS_STORE)) db.deleteObjectStore(SESSIONS_STORE);
        if (db.objectStoreNames.contains(CHUNKS_STORE)) db.deleteObjectStore(CHUNKS_STORE);
        db.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
        const chunkStore = db.createObjectStore(CHUNKS_STORE, { keyPath: ["sessionId", "seq"] });
        chunkStore.createIndex(BY_SESSION_INDEX, "sessionId");
        const tagStore = db.createObjectStore(TAGS_STORE, { autoIncrement: true });
        tagStore.createIndex(BY_SESSION_INDEX, "sessionId");
      }
      if (event.oldVersion < 3) {
        // Additive only (D-43) — a deliberate departure from the v1->v2
        // branch above. D-28's wipe happened because a v1 session held two
        // interleaved chunk sequences the in-room reader physically could
        // not assemble, so that data was unreadable, not merely old. A v2
        // take is fully readable — audio plus tag track — so destroying it
        // to avoid rendering one extra state would be exactly the
        // behind-your-back deletion D-32 refused. This branch therefore
        // touches `sessions`, `chunks` and `tags` not at all: it only
        // creates the new `transcript` store. A v2 take simply has no
        // transcript, which is a state the downloads panel renders
        // honestly rather than a state this upgrade needs to prevent.
        const transcriptStore = db.createObjectStore(TRANSCRIPT_STORE, {
          keyPath: ["sessionId", "seq"],
        });
        transcriptStore.createIndex(BY_SESSION_INDEX, "sessionId");
      }
      if (event.oldVersion < 4) {
        // Additive only (D-72) — the same departure the v3 branch above
        // already made from the v1->v2 wipe. A v3 take is fully readable
        // (audio, tag track, and transcript all intact), so destroying
        // anything to avoid rendering one extra "not yet analysed" state
        // would be exactly the behind-your-back deletion D-32 refused.
        // This branch therefore touches `sessions`, `chunks`, `tags` and
        // `transcript` not at all: it only creates the new `documents`
        // store. A v3 take simply has no feedback document, which is a
        // state the takes list renders honestly rather than a state this
        // upgrade needs to prevent. `keyPath: "sessionId"` (no index, not
        // a compound key like `transcript`'s) because there is exactly one
        // stored feedback document per take, replaced wholesale on
        // regeneration — never a growing history.
        db.createObjectStore(DOCUMENTS_STORE, { keyPath: "sessionId" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (autoCloseOnVersionChange) {
        db.onversionchange = () => db.close();
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Writes a new `RecordingSession` record with status `"recording"`.
 *
 * Uses `durability: "strict"` (WINDOWS #2): this store's default ("relaxed")
 * durability lets the browser report a transaction complete before the write
 * is actually flushed to the on-disk backing store, trading a small amount
 * of latency for throughput. That trade is the right one for a chunk written
 * every five seconds (D-13 already accepts losing the final one), but it is
 * the wrong one for the one record `findResumableSession` depends on to
 * recover anything at all — a session row that is merely "complete" in the
 * renderer but not yet durable can vanish together with every chunk written
 * after it, which reads as a recovered take that "never existed" rather than
 * one that lost its final few seconds. This write happens once per take, so
 * the added latency costs nothing worth trading away.
 *
 * Also writes the three transcription-era fields explicitly (D-52/D-53/D-55),
 * under this same durability argument — they must exist on the row before
 * the first chunk can arrive, exactly like every other field here:
 * - `keepAudio` — the caller's D-55 opt-in answer, settled at the consent
 *   step before this call, never defaulted here.
 * - `audioDeleted: false` — nothing has been deleted yet.
 * - `transcriptStatus: "running"` — transcription is always on (D-45), so a
 *   take is transcribing from the instant it exists; a row that crashes
 *   mid-take is therefore correctly found "running" and so incomplete,
 *   which is the safe reading for the D-53 retention gate.
 */
export async function createSession(
  db: IDBDatabase,
  session: Omit<RecordingSession, "status" | "durationMs" | "audioDeleted" | "transcriptStatus"> & {
    keepAudio: boolean;
  },
): Promise<RecordingSession> {
  const record: RecordingSession = {
    ...session,
    status: "recording",
    durationMs: 0,
    sizeBytes: 0,
    audioDeleted: false,
    transcriptStatus: "running",
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readwrite", { durability: "strict" });
    tx.objectStore(SESSIONS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return record;
}

/**
 * Writes one chunk and resolves only once its transaction completes (D-13)
 * — the chunk must be on disk before the next one can arrive. A quota
 * failure rejects with the IndexedDB-quota copy from the UI-SPEC
 * Copywriting Contract while leaving chunks already written untouched.
 */
export async function appendChunk(
  db: IDBDatabase,
  meta: AudioChunkMeta,
  blob: Blob,
): Promise<void> {
  const record: AudioChunkRecord = { ...meta, blob };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, "readwrite");
    tx.objectStore(CHUNKS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const isQuotaError = tx.error?.name === "QuotaExceededError";
      reject(
        isQuotaError
          ? new Error(
              "This browser ran out of local storage space to save the recording. Free up space or shorten the interview, then try again. Your recording so far has been kept.",
            )
          : tx.error || new Error("Failed to save a recording chunk."),
      );
    };
  });
}

/**
 * Writes one spacebar press and resolves only once its transaction
 * completes, mirroring `appendChunk`'s discipline exactly. It uses its own
 * transaction on the tags store rather than sharing one with a chunk write
 * — a press and a chunk are independent facts, and a press must never be
 * delayed behind a five-second audio write.
 */
export async function appendTagPress(db: IDBDatabase, press: TagPress): Promise<void> {
  return new Promise((resolve, reject) => {
    // durability: "strict" (WINDOWS #2's reasoning applies here too, at a
    // much lower cost): a press happens on human timescales, not every five
    // seconds, and a lost last-speaker press misattributes a whole recovered
    // or resumed span (T-04-15-02) rather than costing a few seconds of tail
    // audio the way a lost chunk does.
    const tx = db.transaction(TAGS_STORE, "readwrite", { durability: "strict" });
    tx.objectStore(TAGS_STORE).put(press);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to save a tag press."));
  });
}

/**
 * Reads one session's tag presses through the `bySession` index, validating
 * each record field by field the way `normaliseSessionRecord` validates a
 * session — a record whose `sessionId`, `tsMs` or `speaker` is missing or of
 * the wrong type is skipped rather than crashing span derivation. Degrades to
 * an empty array on any storage failure, sorted ascending by `tsMs`.
 */
export async function listTagPresses(sessionId: string): Promise<TagPress[]> {
  try {
    const db = await openRecordingDB();
    const rawRecords = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(TAGS_STORE, "readonly");
      const index = tx.objectStore(TAGS_STORE).index(BY_SESSION_INDEX);
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

    const presses: TagPress[] = [];
    for (const raw of rawRecords) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      if (typeof record.sessionId !== "string" || record.sessionId.length === 0) continue;
      if (typeof record.tsMs !== "number") continue;
      if (record.speaker !== "candidate" && record.speaker !== "interviewer") continue;
      presses.push({ sessionId: record.sessionId, tsMs: record.tsMs, speaker: record.speaker });
    }
    return presses.sort((a, b) => a.tsMs - b.tsMs);
  } catch {
    return [];
  }
}

/**
 * Derives a strict contiguous partition of speaker spans from a press log
 * (D-26, D-27). Pure — touches no browser API — so Phase 7 can test it and
 * `scripts/check-tag-track.ts` can import it under Node. The opening span
 * always belongs to `"interviewer"` (D-25); the final span always closes at
 * `finalAudioElapsedMs` (D-29), the same clock `audioElapsedMs` defines. Any
 * span that is not strictly increasing (two presses landing in the same
 * millisecond, or a press exactly at the final duration) is dropped, and
 * adjacent spans carrying the same speaker are merged, so the emitted list
 * is always strictly increasing and still partitions the recording end to
 * end.
 *
 * A press at or after `finalAudioElapsedMs` is dropped before pairing, not
 * after (04-15, D-29): for a clean stop the boundary is read after the last
 * possible press, so this can never trigger; for a recovered take, the
 * boundary is the last chunk that reached disk, and a press can land in the
 * moments after it. Filtering *before* pairing is what matters — pairing
 * first and only dropping the resulting zero/negative-length span would
 * still leave the *previous* span's `endMs` sitting at that out-of-range
 * press's timestamp, which is exactly the "span points past the end of the
 * file" outcome D-29 forbids.
 */
export function deriveSpans(presses: TagPress[], finalAudioElapsedMs: number): TagSpan[] {
  const sorted = [...presses]
    .filter((press) => press.tsMs < finalAudioElapsedMs)
    .sort((a, b) => a.tsMs - b.tsMs);
  const raw: TagSpan[] = [];
  let cursor = 0;
  let current: Speaker = "interviewer";
  for (const press of sorted) {
    raw.push({ startMs: cursor, endMs: press.tsMs, speaker: current });
    cursor = press.tsMs;
    current = press.speaker;
  }
  raw.push({ startMs: cursor, endMs: finalAudioElapsedMs, speaker: current });

  const spans: TagSpan[] = [];
  for (const span of raw) {
    if (span.endMs <= span.startMs) continue;
    const last = spans[spans.length - 1];
    if (last && last.speaker === span.speaker && last.endMs === span.startMs) {
      last.endMs = span.endMs;
    } else {
      spans.push({ ...span });
    }
  }
  return spans;
}

/**
 * Marks a session stopped with its final duration. `durability: "strict"`
 * for the same reason `createSession` uses it — this is the write that
 * moves a take out of `findResumableSession`'s "still recording" filter, and
 * it happens once per take.
 */
export async function markSessionStopped(
  db: IDBDatabase,
  sessionId: string,
  durationMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readwrite", { durability: "strict" });
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = () => {
      const existing = getReq.result as RecordingSession | undefined;
      if (existing) store.put({ ...existing, status: "stopped", durationMs });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * D-53's whole retention decision, in one place. Pure — touches no browser
 * API — so `scripts/check-tag-track.ts` can assert its entire truth table
 * under Node. Deletion is the last step and every ambiguity resolves to
 * keeping: this returns `true` only when every one of the five conditions
 * below holds, and `false` for every other combination, including any
 * combination this doc comment doesn't enumerate by name — there is no
 * catch-all "and otherwise delete" branch anywhere in this function.
 *
 * - `take.keepAudio === false` — strict equality, not falsiness. An absent
 *   field means a take recorded before the D-55 opt-in existed;
 *   `normaliseSessionRecord` already defaults it to `true` for exactly this
 *   reason, so a pre-v3 take always fails this check and keeps its audio
 *   (D-32, D-43).
 * - `take.status === "stopped"` — a take still recording (or a stale
 *   crash-recovered row that was never closed) is never a deletion
 *   candidate.
 * - `take.transcriptStatus === "complete"` — a still-`"running"` worker, an
 *   `"incomplete"` drain, and the pre-v3 `"none"` default all keep the
 *   audio, because deleting it while any part of the transcript is missing,
 *   in flight, or errored would destroy the only source for the missing
 *   part.
 * - `take.audioDeleted !== true` — a take already deleted is not deleted
 *   twice.
 * - `segmentCount > 0` — a transcript marked `"complete"` but holding no
 *   segments means nothing was captured, or nothing was said; the audio is
 *   then the only surviving record of the take, and deleting it destroys
 *   that record for no reason worth the risk.
 */
export function shouldDeleteAudio(take: RecordingSession, segmentCount: number): boolean {
  return (
    take.keepAudio === false &&
    take.status === "stopped" &&
    take.transcriptStatus === "complete" &&
    take.audioDeleted !== true &&
    segmentCount > 0
  );
}

/**
 * Deletes only a session's `chunks` store records, through the `bySession`
 * index cursor, counting what it removed, then marks the session row
 * `audioDeleted: true` with `sizeBytes: 0` through the same
 * `updateSessionTranscriptState`/`updateSessionSize` read-modify-write
 * helpers every other session-row patch in this file already uses — so it
 * touches no other field on the `sessions` row. Opens no transaction naming
 * the `tags` or `transcript` stores anywhere in this function (D-54 — the
 * tag-track sidecar, and the transcript itself, are always kept).
 *
 * Resolves — never rejects — returning the count of chunk records actually
 * removed, or 0 on any failure. This is this module's existing
 * degrade-to-safe-default discipline applied to a delete: a failed deletion
 * leaves the audio still there, which is the safe direction (D-53).
 *
 * The only caller is `LiveInterview.tsx`'s post-`finish()` continuation,
 * guarded by `shouldDeleteAudio` immediately before the call — never from a
 * write path, and never anywhere else in this codebase.
 */
export async function deleteSessionAudio(sessionId: string): Promise<number> {
  try {
    const db = await openRecordingDB();
    let deletedCount = 0;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readwrite", { durability: "strict" });
      const index = tx.objectStore(CHUNKS_STORE).index(BY_SESSION_INDEX);
      const cursorReq = index.openCursor(IDBKeyRange.only(sessionId));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        cursor.delete();
        deletedCount++;
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await updateSessionTranscriptState(db, sessionId, { audioDeleted: true });
    await updateSessionSize(db, sessionId, 0);
    db.close();
    return deletedCount;
  } catch {
    return 0;
  }
}

/**
 * Records a finished take's total byte size, once, after `markSessionStopped`
 * has already fired. Deliberately not folded into `markSessionStopped` — that
 * call fires before the blob assembly so a crash immediately after Stop still
 * finds the take marked stopped, and delaying it until the byte total is
 * known would give that guarantee up. Uses the same read-modify-write shape
 * `markSessionStopped` uses.
 */
export async function updateSessionSize(
  db: IDBDatabase,
  sessionId: string,
  sizeBytes: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = () => {
      const existing = getReq.result as RecordingSession | undefined;
      if (existing) store.put({ ...existing, sizeBytes });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Patches a session's transcript-lifecycle fields (D-52/D-53's
 * `transcriptStatus`, `keepAudio`, `audioDeleted`) — the same
 * read-modify-write shape `updateSessionSize` uses above.
 * `durability: "strict"`, as `createSession`/`markSessionStopped` already
 * use: a lost `audioDeleted` flag would make the downloads panel describe a
 * file that is gone.
 */
export async function updateSessionTranscriptState(
  db: IDBDatabase,
  sessionId: string,
  patch: Partial<Pick<RecordingSession, "transcriptStatus" | "keepAudio" | "audioDeleted">>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readwrite", { durability: "strict" });
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = () => {
      const existing = getReq.result as RecordingSession | undefined;
      if (existing) store.put({ ...existing, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** One session's chunk records, sorted by sequence. */
export async function listChunks(db: IDBDatabase, sessionId: string): Promise<AudioChunkRecord[]> {
  try {
    const records = await new Promise<AudioChunkRecord[]>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readonly");
      const index = tx.objectStore(CHUNKS_STORE).index(BY_SESSION_INDEX);
      const results: AudioChunkRecord[] = [];
      const req = index.openCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(results);
          return;
        }
        results.push(cursor.value as AudioChunkRecord);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return records.sort((a, b) => a.seq - b.seq);
  } catch {
    return [];
  }
}

/**
 * The D-29 closing boundary, as a function: the largest readable chunk
 * timestamp in the list, or 0 for an empty or entirely-unreadable list. Pure
 * and order-independent — touches no storage and no browser API — so both
 * the resumable-session read and `closeRecoveredSession` below can share one
 * definition of "where a take ends" with `scripts/check-tag-track.ts`
 * asserting it directly. A chunk whose `tsMs` is not a number is ignored
 * rather than poisoning the result (a defensive read of storage, mirroring
 * this module's other degrade-on-bad-input rules) — the field being absent
 * or malformed says nothing about the chunk's real position, so it must not
 * silently become 0 and win a `Math.max`-style comparison it has no claim to.
 */
export function recoveredEndMs(chunks: { tsMs: unknown }[]): number {
  let maxTsMs = 0;
  for (const chunk of chunks) {
    if (typeof chunk.tsMs === "number" && chunk.tsMs > maxTsMs) maxTsMs = chunk.tsMs;
  }
  return maxTsMs;
}

/**
 * Aggregates a session's readable chunk metadata into the shape the download
 * surface needs: the total chunk count found in storage, how many of those
 * were actually readable, the summed byte size of the readable chunks, and a
 * duration equal to `recoveredEndMs` of those same chunks.
 *
 * This used to add one `TIMESLICE_MS` on top of the latest chunk's `tsMs`,
 * reasoning that a chunk's timestamp marks when it was *delivered* rather
 * than the span it covers, and that the recording therefore truly ends a
 * timeslice later. That reasoning was wrong: a chunk delivered at a given
 * instant carries the audio *up to* that instant — the recording's real end
 * is that instant, not five seconds past it. The practical consequence is
 * that this function now reports the exact same number D-29 closes a
 * recovered tag track's final span at, which is the point — a take can no
 * longer have two different "ends" depending on which half of it you ask.
 *
 * Pure — touches no storage and no browser API — so Phase 7's test suite can
 * exercise the counting and ordering logic without an IndexedDB fixture.
 */
export const summariseChunks = (
  readableChunks: AudioChunkMeta[],
  totalChunkCount: number,
): RecordingSummary => {
  let totalBytes = 0;
  for (const chunk of readableChunks) {
    totalBytes += chunk.size;
  }
  return {
    chunkCount: totalChunkCount,
    readableCount: readableChunks.length,
    totalBytes,
    durationMs: recoveredEndMs(readableChunks),
  };
};

/**
 * Reads a session's stored chunk records in sequence order and concatenates
 * them into a single `Blob` carrying the session's negotiated mime type — no
 * resampling, no re-encoding, no channel or rate conversion (D-19). Each
 * record is read defensively: one that is missing, whose `blob` is absent or
 * of the wrong shape, or whose read throws, is counted as unreadable and
 * skipped rather than aborting the whole assembly — a partial interview
 * recording still has real value, and refusing to hand it over because one
 * chunk failed destroys usable evidence to protect a tidy invariant. When
 * zero chunks are readable, the returned `blob` is `null` rather than an
 * empty `Blob`, so the caller can distinguish "nothing to give you" from
 * "here is a zero-length file". Resolves — never rejects — on any storage
 * failure, matching this module's existing degrade-to-safe-default
 * discipline; a top-level failure is reported as zero chunks found, zero
 * readable, zero unreadable (the read simply could not happen at all).
 */
export const assembleSessionBlob = async (
  sessionId: string,
  mimeType: string,
): Promise<{ blob: Blob | null; summary: RecordingSummary; unreadableCount: number }> => {
  try {
    const db = await openRecordingDB();
    const rawRecords = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readonly");
      const index = tx.objectStore(CHUNKS_STORE).index(BY_SESSION_INDEX);
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

    const sorted = rawRecords.slice().sort((a, b) => {
      const seqA =
        typeof (a as { seq?: unknown })?.seq === "number"
          ? (a as { seq: number }).seq
          : Number.MAX_SAFE_INTEGER;
      const seqB =
        typeof (b as { seq?: unknown })?.seq === "number"
          ? (b as { seq: number }).seq
          : Number.MAX_SAFE_INTEGER;
      return seqA - seqB;
    });

    const readableChunks: AudioChunkMeta[] = [];
    const blobParts: Blob[] = [];
    let unreadableCount = 0;

    for (const raw of sorted) {
      try {
        const record = raw as Partial<AudioChunkRecord> | undefined;
        if (
          !record ||
          !(record.blob instanceof Blob) ||
          typeof record.size !== "number" ||
          typeof record.tsMs !== "number" ||
          typeof record.seq !== "number"
        ) {
          unreadableCount++;
          continue;
        }
        blobParts.push(record.blob);
        readableChunks.push({
          sessionId,
          seq: record.seq,
          tsMs: record.tsMs,
          size: record.size,
          mimeType: typeof record.mimeType === "string" ? record.mimeType : mimeType,
        });
      } catch {
        unreadableCount++;
      }
    }

    const summary = summariseChunks(readableChunks, sorted.length);
    const blob = blobParts.length > 0 ? new Blob(blobParts, { type: mimeType }) : null;
    return { blob, summary, unreadableCount };
  } catch {
    return {
      blob: null,
      summary: summariseChunks([], 0),
      unreadableCount: 0,
    };
  }
};

/**
 * Deletes the whole `live_interview_recordings` database by name (D-12) — the
 * same discipline `handleClearStoredData` already follows for its enumerated
 * localStorage keys: name every store explicitly, never call a blanket clear,
 * because on a shared origin a wholesale storage clear would take another
 * application's data with it.
 *
 * Resolves — never rejects — in every case, so the "Clear stored data"
 * button can never be left mid-clear by a storage fault. The resolved
 * `DeleteRecordingDBOutcome` tells the caller what actually happened; this
 * function does not decide what the visitor is told, the caller does:
 * - `"deleted"`: the database is actually gone.
 * - `"blocked"`: a connection is still open past the grace window below, so
 *   the deletion has NOT happened — reporting this as a success would tell
 *   the visitor their data is gone when it is still on disk.
 * - `"error"`: logged via `console.error` so the failure is visible in
 *   DevTools without surfacing it to the visitor.
 *
 * `onblocked` firing is not itself the final word (LIVE-09): every
 * connection this app opens except the active-recording handle self-closes
 * the instant it receives the `versionchange` event this delete request just
 * dispatched (see `openRecordingDB`), so `onsuccess` almost always follows
 * `onblocked` within a tick or two. Resolving on the first `onblocked` — as
 * this used to — reported "blocked" for a delete that was, in every
 * observed case, seconds away from actually completing on its own. The
 * 1500ms grace window below is what lets that `onsuccess` still win; only a
 * connection that genuinely never closes (an active recording still writing,
 * or another tab running stale code with no `versionchange` handler) falls
 * through to the honest `"blocked"` outcome.
 */
export type DeleteRecordingDBOutcome = "deleted" | "blocked" | "error";

export function deleteRecordingDB(): Promise<DeleteRecordingDBOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: DeleteRecordingDBOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => finish("deleted");
    req.onerror = () => {
      console.error("Failed to delete the recordings database.", req.error);
      finish("error");
    };
    req.onblocked = () => {
      window.setTimeout(() => finish("blocked"), 1500);
    };
  });
}

/**
 * Whether the `chunks` store, the `transcript` store, the `documents`
 * store, or the `sessions` store holds at least one record. Uses a
 * `count()` on each store rather than reading records — the caller only
 * needs a boolean and the audio blobs are large.
 *
 * Before this phase this checked only the `chunks` store, which was
 * sufficient while every take had audio. Once a take's audio can be deleted
 * under D-52 while its transcript and session row remain, chunks alone would
 * answer "nothing is stored" while a full transcript still sits on disk —
 * and `App.tsx` gates the "Clear stored data" button on this function, so a
 * transcript-only take would strand that data behind a disabled control.
 * `DOCUMENTS_STORE` joins the list for the same reason (D-72, RESEARCH
 * Pitfall 4): once a take can hold a feedback document with no audio left,
 * "is anything stored" must not answer "no" while a generated document
 * still sits on disk. This checks all four stores so the question is
 * honestly "is anything stored", not "is there still audio".
 *
 * Degrades to `false` on any failure (mirrors `loadContext`'s
 * try/catch-to-safe-default discipline in `src/App.tsx`) — a private
 * browsing mode that blocks IndexedDB reports "nothing stored", which is
 * true.
 */
export const hasStoredRecordings = async (): Promise<boolean> => {
  try {
    const db = await openRecordingDB();
    const counts = await Promise.all(
      [CHUNKS_STORE, TRANSCRIPT_STORE, SESSIONS_STORE, DOCUMENTS_STORE].map(
        (storeName) =>
          new Promise<number>((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          }),
      ),
    );
    db.close();
    return counts.some((count) => count > 0);
  } catch {
    return false;
  }
};

/**
 * The recovered session together with enough summary data for the recovery
 * prompt to say how much was captured, without reading every chunk's blob.
 */
export interface ResumableSessionInfo {
  session: RecordingSession;
  chunkCount: number;
  latestTsMs: number;
  /** How many speaker marks were recovered for this session (04-15). */
  pressCount: number;
  /**
   * Who was marked when the crash happened, from the last recovered press —
   * `null` when no press was ever made, meaning the take is still on D-25's
   * opening default (the interviewer) rather than an unreadable log. Reading
   * this through `listTagPresses` means a corrupt press log degrades to
   * `pressCount: 0, lastSpeaker: null` rather than failing the recovery of
   * the audio, which is the independent, more important half of the take.
   */
  lastSpeaker: Speaker | null;
}

const KNOWN_TRANSCRIPT_STATUSES: readonly TranscriptStatus[] = [
  "none",
  "running",
  "complete",
  "incomplete",
];

/**
 * Session records read back from storage are input, not trusted internal
 * state (T-04-04) — a record whose `sessionId`, `clockOrigin`, `mimeType` or
 * `declaredSpeaker` is missing or of the wrong type is unusable and skipped.
 * A `declaredSpeaker` that is present but not one of the two known values is
 * normalised to `"candidate"` rather than treated as invalid, since the
 * field itself is present and trustworthy enough to keep the record.
 *
 * The three v3 fields (D-42/D-43) each default independently for a record
 * written before they existed: `transcriptStatus` defaults to `"none"` when
 * absent or not one of the four known values; `audioDeleted` defaults to
 * `false`; and `keepAudio` defaults to **`true`** when absent. That last
 * default is load-bearing — a pre-v3 take predates the opt-in entirely, and
 * defaulting it to the new transcript-only behaviour would let a later
 * retention pass delete audio the operator never agreed to give up (D-32,
 * D-43). Only an explicit stored `false` overrides it.
 *
 * Exported so `scripts/check-tag-track.ts` can exercise its `sizeBytes`
 * defaulting rules directly — a validation rule that cannot be exercised is
 * a validation rule nobody maintains.
 */
export const normaliseSessionRecord = (value: unknown): RecordingSession | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return null;
  if (typeof record.clockOrigin !== "number") return null;
  if (typeof record.mimeType !== "string" || record.mimeType.length === 0) return null;
  if (typeof record.declaredSpeaker !== "string") return null;

  const declaredSpeaker: Speaker =
    record.declaredSpeaker === "interviewer" ? "interviewer" : "candidate";
  const startedAt = typeof record.startedAt === "number" ? record.startedAt : 0;
  const status = record.status === "stopped" ? "stopped" : "recording";
  const durationMs = typeof record.durationMs === "number" ? record.durationMs : 0;
  const sizeBytes = typeof record.sizeBytes === "number" ? record.sizeBytes : 0;

  const transcriptStatus: TranscriptStatus =
    typeof record.transcriptStatus === "string" &&
    (KNOWN_TRANSCRIPT_STATUSES as readonly string[]).includes(record.transcriptStatus)
      ? (record.transcriptStatus as TranscriptStatus)
      : "none";
  const keepAudio = record.keepAudio === false ? false : true;
  const audioDeleted = record.audioDeleted === true;

  return {
    sessionId: record.sessionId,
    startedAt,
    clockOrigin: record.clockOrigin,
    declaredSpeaker,
    mimeType: record.mimeType,
    status,
    durationMs,
    sizeBytes,
    transcriptStatus,
    keepAudio,
    audioDeleted,
  };
};

/**
 * Orders sessions by `startedAt` descending — newest take first. Pure and
 * non-mutating (sorts a shallow copy), and stable for two sessions sharing a
 * `startedAt` (JS `Array.prototype.sort` is spec-guaranteed stable). Exported
 * so `scripts/check-tag-track.ts` can exercise the ordering rule without
 * storage, and so `listStoppedSessions` and any future caller share one
 * ordering definition.
 */
export function sortTakesNewestFirst(sessions: RecordingSession[]): RecordingSession[] {
  return [...sessions].sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Every stopped take, newest-first — the primary read path for the download
 * surface (D-31: the take, not the recording, is the noun the UI is built
 * around). Degrades to an empty array on any failure, matching every other
 * read path in this file.
 */
export async function listStoppedSessions(): Promise<RecordingSession[]> {
  try {
    const db = await openRecordingDB();
    const rawSessions = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readonly");
      const req = tx.objectStore(SESSIONS_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    const stopped = rawSessions
      .map(normaliseSessionRecord)
      .filter((s): s is RecordingSession => s !== null && s.status === "stopped");
    return sortTakesNewestFirst(stopped);
  } catch {
    return [];
  }
}

/**
 * The newest session still marked `"recording"` — left over from a crash or
 * a reload, since a clean stop always sets status to `"stopped"` first.
 * Returns null when there is nothing to recover. Resolves — never rejects —
 * on any failure: a private-browsing IndexedDB block, a corrupted record, or
 * a schema mismatch all mean "nothing to recover", which is a safe and
 * honest answer (mirrors `loadContext`'s degrade-to-safe-default discipline
 * in `src/App.tsx`).
 */
export const findResumableSession = async (): Promise<ResumableSessionInfo | null> => {
  try {
    const db = await openRecordingDB();

    const rawSessions = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readonly");
      const req = tx.objectStore(SESSIONS_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const resumable = rawSessions
      .map(normaliseSessionRecord)
      .filter((s): s is RecordingSession => s !== null && s.status === "recording")
      .sort((a, b) => b.startedAt - a.startedAt);

    const newest = resumable[0];
    if (!newest) {
      db.close();
      return null;
    }

    let chunkCount = 0;
    const rawChunks: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readonly");
      const index = tx.objectStore(CHUNKS_STORE).index(BY_SESSION_INDEX);
      const req = index.openCursor(IDBKeyRange.only(newest.sessionId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        chunkCount++;
        rawChunks.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });

    const latestTsMs = recoveredEndMs(rawChunks as { tsMs: unknown }[]);

    db.close();

    // Reads through the same validating, degrade-to-empty tag-press reader
    // every other caller uses — an unreadable press log must cost only the
    // speaker marks, never the audio recovery this function exists for.
    const presses = await listTagPresses(newest.sessionId);
    const pressCount = presses.length;
    const lastSpeaker: Speaker | null = pressCount > 0 ? presses[pressCount - 1].speaker : null;

    return { session: newest, chunkCount, latestTsMs, pressCount, lastSpeaker };
  } catch {
    return null;
  }
};

/**
 * The "keep what was captured" recovery action (D-29, T-04-15-04): marks a
 * crashed take stopped at its own last durable chunk without resuming it,
 * so the audio does not have to be continued to be kept. Reads the
 * session's own chunk records for the closing boundary (`recoveredEndMs`)
 * and byte total, then writes both through the exact read-modify-write shape
 * a clean stop uses (`markSessionStopped` then `updateSessionSize`), so a
 * recovered take that is closed this way is indistinguishable in storage
 * from one that was stopped normally at that same instant.
 *
 * Also writes `transcriptStatus: "incomplete"` — this take's remaining audio
 * was never tapped (D-39 taps the live stream only; D-40 means there is no
 * retroactive path once the stream is gone), so its transcript has a hole by
 * construction. Writing `"incomplete"` here, unconditionally, is what makes
 * `shouldDeleteAudio` keep this take's audio regardless of its `keepAudio`
 * opt-in (D-53) — a crash-recovered take never had a chance to finish
 * transcribing and must never be treated as though it did.
 *
 * Resolves — never rejects — on any storage failure, returning 0: the
 * recovery prompt needs an honest "nothing was saved" it can act on, not a
 * promise that never settles and leaves the prompt stuck open.
 */
export async function closeRecoveredSession(sessionId: string): Promise<number> {
  try {
    const db = await openRecordingDB();
    const rawChunks = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readonly");
      const index = tx.objectStore(CHUNKS_STORE).index(BY_SESSION_INDEX);
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

    const closingMs = recoveredEndMs(rawChunks as { tsMs: unknown }[]);
    let totalBytes = 0;
    for (const raw of rawChunks) {
      const size = (raw as { size?: unknown } | undefined)?.size;
      if (typeof size === "number") totalBytes += size;
    }

    await markSessionStopped(db, sessionId, closingMs);
    await updateSessionSize(db, sessionId, totalBytes);
    await updateSessionTranscriptState(db, sessionId, { transcriptStatus: "incomplete" });
    db.close();
    return closingMs;
  } catch {
    return 0;
  }
}

/**
 * Deletes one session record and all of its chunks, tag presses,
 * transcript segments, and stored feedback document, using the
 * `bySession` index on each multi-row store — otherwise deleting a take
 * orphans its tag track (or, since 05-02, its transcript), or, since D-72,
 * leaves an unreachable feedback document behind. `documents` is keyed
 * directly by `sessionId` (one record per take, no index), so it is
 * removed with a single key delete rather than a cursor walk.
 */
const deleteSessionAndChunks = (db: IDBDatabase, sessionId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(
      [SESSIONS_STORE, CHUNKS_STORE, TAGS_STORE, TRANSCRIPT_STORE, DOCUMENTS_STORE],
      "readwrite",
    );
    tx.objectStore(SESSIONS_STORE).delete(sessionId);
    tx.objectStore(DOCUMENTS_STORE).delete(sessionId);

    const chunksIndex = tx.objectStore(CHUNKS_STORE).index(BY_SESSION_INDEX);
    const chunksCursorReq = chunksIndex.openCursor(IDBKeyRange.only(sessionId));
    chunksCursorReq.onsuccess = () => {
      const cursor = chunksCursorReq.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };

    const tagsIndex = tx.objectStore(TAGS_STORE).index(BY_SESSION_INDEX);
    const tagsCursorReq = tagsIndex.openCursor(IDBKeyRange.only(sessionId));
    tagsCursorReq.onsuccess = () => {
      const cursor = tagsCursorReq.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };

    const transcriptIndex = tx.objectStore(TRANSCRIPT_STORE).index(BY_SESSION_INDEX);
    const transcriptCursorReq = transcriptIndex.openCursor(IDBKeyRange.only(sessionId));
    transcriptCursorReq.onsuccess = () => {
      const cursor = transcriptCursorReq.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

/**
 * Deletes every OTHER session still marked `"recording"` except
 * `keepSessionId`, together with all of its chunks and tag presses (via the
 * `bySession` index). Storage can hold several unfinished sessions — crash
 * twice and there are two — and an interview abandoned two sessions ago is
 * almost certainly dead, so only the newest unfinished session is ever
 * offered and the rest are removed in the same operation.
 *
 * A stopped take is NEVER a candidate for deletion here (D-31): this
 * function reads full session records and normalises them rather than bare
 * keys, specifically so it can filter on status before deleting anything.
 * The earlier version of this function deleted every session except the one
 * kept, with no status filter — on a crash-recovery mount that destroyed
 * every previously stopped take on the very next page load. Resolves —
 * never rejects — on any failure; a storage fault here just leaves a stale
 * unfinished session behind rather than blocking the recovery flow.
 */
export const pruneOlderSessions = async (keepSessionId: string): Promise<void> => {
  try {
    const db = await openRecordingDB();
    const rawSessions = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readonly");
      const req = tx.objectStore(SESSIONS_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const staleRecordingIds = rawSessions
      .map(normaliseSessionRecord)
      .filter(
        (s): s is RecordingSession =>
          s !== null && s.status === "recording" && s.sessionId !== keepSessionId,
      )
      .map((s) => s.sessionId);

    for (const id of staleRecordingIds) {
      await deleteSessionAndChunks(db, id);
    }
    db.close();
  } catch {
    // best-effort cleanup — see doc comment above
  }
};

/** Deletes one session record and all of its chunks by id. Resolves — never rejects. */
export const deleteSession = async (sessionId: string): Promise<void> => {
  try {
    const db = await openRecordingDB();
    await deleteSessionAndChunks(db, sessionId);
    db.close();
  } catch {
    // resolve regardless — a deletion failure degrades to "still there", not a crash
  }
};

/**
 * One past the highest `seq` already stored for a session, so a resumed
 * session continues numbering rather than overwriting existing chunks at the
 * same key. Degrades to 0 on any failure.
 */
export const nextSeqFor = async (sessionId: string): Promise<number> => {
  try {
    const db = await openRecordingDB();
    const chunks = await listChunks(db, sessionId);
    db.close();
    if (chunks.length === 0) return 0;
    return chunks[chunks.length - 1].seq + 1;
  } catch {
    return 0;
  }
};
