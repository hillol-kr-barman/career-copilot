import type { AudioChunkMeta, AudioChunkRecord, RecordingSession, StreamRole } from "../types";

/**
 * Every chunk is written as its own IndexedDB record rather than appended
 * into a growing `Blob` — incremental blob-append rewrites the whole
 * accumulated blob on every write, which is quadratic over a long interview.
 *
 * Schema: database `live_interview_recordings` at version 1, with store
 * `sessions` (keyPath `sessionId`) and store `chunks` (keyPath
 * `["sessionId", "streamRole", "seq"]`, index `bySession` on `sessionId`).
 * Every read path here degrades to a safe empty default on failure rather
 * than throwing into the UI, mirroring `loadContext`'s try/catch discipline
 * in `src/App.tsx`.
 */

export const DB_NAME = "live_interview_recordings";
export const DB_VERSION = 1;

const SESSIONS_STORE = "sessions";
const CHUNKS_STORE = "chunks";
const BY_SESSION_INDEX = "bySession";

export function openRecordingDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = db.createObjectStore(CHUNKS_STORE, {
          keyPath: ["sessionId", "streamRole", "seq"],
        });
        store.createIndex(BY_SESSION_INDEX, "sessionId");
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

/** One stream's chunk records for a session, sorted by sequence. */
export async function listChunks(
  db: IDBDatabase,
  sessionId: string,
  streamRole: StreamRole
): Promise<AudioChunkRecord[]> {
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
        const record = cursor.value as AudioChunkRecord;
        if (record.streamRole === streamRole) results.push(record);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return records.sort((a, b) => a.seq - b.seq);
  } catch {
    return [];
  }
}

/** Concatenates one stream's stored chunks, in sequence order, into a `Blob`. */
export async function assembleBlob(
  db: IDBDatabase,
  sessionId: string,
  streamRole: StreamRole,
  mimeType: string
): Promise<Blob> {
  const chunks = await listChunks(db, sessionId, streamRole);
  return new Blob(
    chunks.map((c) => c.blob),
    { type: mimeType }
  );
}

/**
 * Deletes the whole `live_interview_recordings` database by name (D-12) — the
 * same discipline `handleClearStoredData` already follows for its enumerated
 * localStorage keys: name every store explicitly, never call a blanket clear,
 * because on a shared origin a wholesale storage clear would take another
 * application's data with it.
 *
 * Resolves — never rejects — in every case, so the "Clear stored data"
 * button can never be left mid-clear by a storage fault:
 * - Success: the database is gone.
 * - `blocked` (another tab still has a connection open): the deletion is
 *   queued and completes once that tab releases it; hanging this button on
 *   another tab's lifetime would be worse than proceeding.
 * - `error`: logged via `console.error` so the failure is visible in
 *   DevTools without surfacing it to the visitor.
 */
export function deleteRecordingDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
    req.onerror = () => {
      console.error("Failed to delete the recordings database.", req.error);
      resolve();
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
