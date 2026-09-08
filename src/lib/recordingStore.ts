import type {
  AudioChunkMeta,
  AudioChunkRecord,
  RecordingSession,
  RecordingSummary,
  Speaker,
  TagPress,
  TagSpan,
} from "../types";
import { TIMESLICE_MS } from "./recorder";

/**
 * Every chunk is written as its own IndexedDB record rather than appended
 * into a growing `Blob` — incremental blob-append rewrites the whole
 * accumulated blob on every write, which is quadratic over a long interview.
 *
 * Schema: database `live_interview_recordings` at version 2, with store
 * `sessions` (keyPath `sessionId`), store `chunks` (keyPath
 * `["sessionId", "seq"]`, index `bySession` on `sessionId`), and store `tags`
 * (`autoIncrement` key, index `bySession` on `sessionId`). Version 2 is a
 * one-way, non-migrating upgrade (D-28): `onupgradeneeded` drops and
 * recreates `sessions` and `chunks` rather than reading version-1 records
 * forward, because a version-1 session holds two interleaved chunk sequences
 * this reader cannot assemble into one file and the `chunks` keyPath itself
 * changes shape. Every read path here degrades to a safe empty default on
 * failure rather than throwing into the UI, mirroring `loadContext`'s
 * try/catch discipline in `src/App.tsx`.
 */

export const DB_NAME = "live_interview_recordings";
export const DB_VERSION = 2;

const SESSIONS_STORE = "sessions";
const CHUNKS_STORE = "chunks";
const TAGS_STORE = "tags";
const BY_SESSION_INDEX = "bySession";

export function openRecordingDB(): Promise<IDBDatabase> {
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Writes a new `RecordingSession` record with status `"recording"`. */
export async function createSession(
  db: IDBDatabase,
  session: Omit<RecordingSession, "status" | "durationMs">
): Promise<RecordingSession> {
  const record: RecordingSession = { ...session, status: "recording", durationMs: 0 };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
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
export async function appendChunk(db: IDBDatabase, meta: AudioChunkMeta, blob: Blob): Promise<void> {
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
              "This browser ran out of local storage space to save the recording. Free up space or shorten the interview, then try again. Your recording so far has been kept."
            )
          : tx.error || new Error("Failed to save a recording chunk.")
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
    const tx = db.transaction(TAGS_STORE, "readwrite");
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
 */
export function deriveSpans(presses: TagPress[], finalAudioElapsedMs: number): TagSpan[] {
  const sorted = [...presses].sort((a, b) => a.tsMs - b.tsMs);
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

/** Marks a session stopped with its final duration. */
export async function markSessionStopped(
  db: IDBDatabase,
  sessionId: string,
  durationMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
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
 * Aggregates a session's readable chunk metadata into the shape the download
 * surface needs: the total chunk count found in storage, how many of those
 * were actually readable, the summed byte size of the readable chunks, and a
 * duration derived from the latest readable chunk's `tsMs` plus one
 * timeslice (a chunk's timestamp marks when it was delivered, not the span
 * it covers, so the true end of the recording is one timeslice later). Pure
 * — touches no storage and no browser API — so Phase 7's test suite can
 * exercise the counting and ordering logic without an IndexedDB fixture.
 */
export const summariseChunks = (
  readableChunks: AudioChunkMeta[],
  totalChunkCount: number
): RecordingSummary => {
  let totalBytes = 0;
  let maxTsMs = 0;
  for (const chunk of readableChunks) {
    totalBytes += chunk.size;
    if (chunk.tsMs > maxTsMs) maxTsMs = chunk.tsMs;
  }
  return {
    chunkCount: totalChunkCount,
    readableCount: readableChunks.length,
    totalBytes,
    durationMs: readableChunks.length > 0 ? maxTsMs + TIMESLICE_MS : 0,
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
  mimeType: string
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
      const seqA = typeof (a as { seq?: unknown })?.seq === "number" ? (a as { seq: number }).seq : Number.MAX_SAFE_INTEGER;
      const seqB = typeof (b as { seq?: unknown })?.seq === "number" ? (b as { seq: number }).seq : Number.MAX_SAFE_INTEGER;
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
 * - `"blocked"`: another connection (this tab or another) is still open, so
 *   the deletion is queued behind it and has NOT happened yet — the request
 *   never reaches `onsuccess` until that connection closes. Reporting this as
 *   a success would tell the visitor their data is gone when it is still on
 *   disk.
 * - `"error"`: logged via `console.error` so the failure is visible in
 *   DevTools without surfacing it to the visitor.
 */
export type DeleteRecordingDBOutcome = "deleted" | "blocked" | "error";

export function deleteRecordingDB(): Promise<DeleteRecordingDBOutcome> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve("deleted");
    req.onblocked = () => resolve("blocked");
    req.onerror = () => {
      console.error("Failed to delete the recordings database.", req.error);
      resolve("error");
    };
  });
}

/**
 * Whether the `chunks` store holds at least one record. Uses a count on the
 * store rather than reading records — the caller only needs a boolean and
 * the blobs are large.
 *
 * Degrades to `false` on any failure (mirrors `loadContext`'s
 * try/catch-to-safe-default discipline in `src/App.tsx`) — a private
 * browsing mode that blocks IndexedDB reports "nothing stored", which is
 * true.
 */
export const hasStoredRecordings = async (): Promise<boolean> => {
  try {
    const db = await openRecordingDB();
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readonly");
      const req = tx.objectStore(CHUNKS_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return count > 0;
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
}

/**
 * Session records read back from storage are input, not trusted internal
 * state (T-04-04) — a record whose `sessionId`, `clockOrigin`, `mimeType` or
 * `declaredSpeaker` is missing or of the wrong type is unusable and skipped.
 * A `declaredSpeaker` that is present but not one of the two known values is
 * normalised to `"candidate"` rather than treated as invalid, since the
 * field itself is present and trustworthy enough to keep the record.
 */
const normaliseSessionRecord = (value: unknown): RecordingSession | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return null;
  if (typeof record.clockOrigin !== "number") return null;
  if (typeof record.mimeType !== "string" || record.mimeType.length === 0) return null;
  if (typeof record.declaredSpeaker !== "string") return null;

  const declaredSpeaker: Speaker = record.declaredSpeaker === "interviewer" ? "interviewer" : "candidate";
  const startedAt = typeof record.startedAt === "number" ? record.startedAt : 0;
  const status = record.status === "stopped" ? "stopped" : "recording";
  const durationMs = typeof record.durationMs === "number" ? record.durationMs : 0;

  return {
    sessionId: record.sessionId,
    startedAt,
    clockOrigin: record.clockOrigin,
    declaredSpeaker,
    mimeType: record.mimeType,
    status,
    durationMs,
  };
};

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
    let latestTsMs = 0;

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
        const chunk = cursor.value as AudioChunkRecord;
        chunkCount++;
        if (chunk.tsMs > latestTsMs) latestTsMs = chunk.tsMs;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });

    db.close();
    return { session: newest, chunkCount, latestTsMs };
  } catch {
    return null;
  }
};

/**
 * Deletes one session record and all of its chunks and tag presses, using
 * the `bySession` index on each store — otherwise deleting a take orphans
 * its tag track.
 */
const deleteSessionAndChunks = (db: IDBDatabase, sessionId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction([SESSIONS_STORE, CHUNKS_STORE, TAGS_STORE], "readwrite");
    tx.objectStore(SESSIONS_STORE).delete(sessionId);

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

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

/**
 * Deletes every unfinished session except `keepSessionId`, together with all
 * of its chunks (via the `bySession` index). Storage can hold several
 * unfinished sessions — crash twice and there are two — and an interview
 * abandoned two sessions ago is almost certainly dead, so only the newest is
 * ever offered and the rest are removed in the same operation. Resolves —
 * never rejects — on any failure; a storage fault here just leaves a stale
 * session behind rather than blocking the recovery flow.
 */
export const pruneOlderSessions = async (keepSessionId: string): Promise<void> => {
  try {
    const db = await openRecordingDB();
    const allIds = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readonly");
      const req = tx.objectStore(SESSIONS_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    for (const id of allIds) {
      if (id === keepSessionId) continue;
      await deleteSessionAndChunks(db, String(id));
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
