import type {
  AudioChunkMeta,
  AudioChunkRecord,
  RecordingSession,
  StreamRole,
  UserRole,
} from "../types";

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

/**
 * The recovered session together with enough summary data for the recovery
 * prompt to say how much was captured, without reading every chunk's blob.
 */
export interface ResumableSessionInfo {
  session: RecordingSession;
  chunkCounts: Partial<Record<StreamRole, number>>;
  latestTsMs: number;
}

/**
 * Session records read back from storage are input, not trusted internal
 * state (T-04-04) — a record whose `sessionId`, `clockOrigin`, `mimeType` or
 * `userRole` is missing or of the wrong type is unusable and skipped. A
 * `userRole` that is present but not one of the two known values is
 * normalised to `"candidate"` rather than treated as invalid, since the
 * field itself is present and trustworthy enough to keep the record.
 */
const normaliseSessionRecord = (value: unknown): RecordingSession | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return null;
  if (typeof record.clockOrigin !== "number") return null;
  if (typeof record.mimeType !== "string" || record.mimeType.length === 0) return null;
  if (typeof record.userRole !== "string") return null;

  const userRole: UserRole = record.userRole === "interviewer" ? "interviewer" : "candidate";
  const startedAt = typeof record.startedAt === "number" ? record.startedAt : 0;
  const status = record.status === "stopped" ? "stopped" : "recording";
  const durationMs = typeof record.durationMs === "number" ? record.durationMs : 0;

  return {
    sessionId: record.sessionId,
    startedAt,
    clockOrigin: record.clockOrigin,
    userRole,
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

    const chunkCounts: Partial<Record<StreamRole, number>> = {};
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
        chunkCounts[chunk.streamRole] = (chunkCounts[chunk.streamRole] ?? 0) + 1;
        if (chunk.tsMs > latestTsMs) latestTsMs = chunk.tsMs;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });

    db.close();
    return { session: newest, chunkCounts, latestTsMs };
  } catch {
    return null;
  }
};

/** Deletes one session record and all of its chunks, using the `bySession` index. */
const deleteSessionAndChunks = (db: IDBDatabase, sessionId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction([SESSIONS_STORE, CHUNKS_STORE], "readwrite");
    tx.objectStore(SESSIONS_STORE).delete(sessionId);
    const index = tx.objectStore(CHUNKS_STORE).index(BY_SESSION_INDEX);
    const cursorReq = index.openCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
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
 * One past the highest `seq` already stored for a session/stream-role pair,
 * so a resumed session continues numbering rather than overwriting existing
 * chunks at the same key. Degrades to 0 on any failure.
 */
export const nextSeqFor = async (sessionId: string, streamRole: StreamRole): Promise<number> => {
  try {
    const db = await openRecordingDB();
    const chunks = await listChunks(db, sessionId, streamRole);
    db.close();
    if (chunks.length === 0) return 0;
    return chunks[chunks.length - 1].seq + 1;
  } catch {
    return 0;
  }
};
