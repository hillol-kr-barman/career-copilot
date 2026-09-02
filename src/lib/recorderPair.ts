import type { AudioChunkMeta, StreamRole, UserRole } from "../types";

/**
 * Records the mic and tab streams independently — one `MediaRecorder` each —
 * both timestamped from a single shared clock (D-03) so Phase 5 can merge
 * them by time. `dataavailable` fires per timeslice, on `stop()` and on
 * `requestData()`, but never on `pause()` — timeslice boundaries must never
 * be used as a clock; every chunk's offset is measured from one
 * `performance.now()` origin captured once at start.
 */

/** Bounds crash loss to 5s of audio; ~540 chunks per stream over 45 minutes. */
export const TIMESLICE_MS = 5000;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

/** First MIME type this browser's `MediaRecorder` actually supports. */
export function pickSupportedMimeType(): string {
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  throw new Error("No supported audio recording format in this browser.");
}

/**
 * Speaker separation is physical, not identity-based (D-06): the mic track
 * is whoever is at this laptop, the tab track is whoever is on the call. The
 * visitor's own role goes to `mic`; the opposite role goes to `tab`.
 */
export function resolveStreamRoles(userRole: UserRole): { mic: StreamRole; tab: StreamRole } {
  return {
    mic: userRole,
    tab: userRole === "candidate" ? "interviewer" : "candidate",
  };
}

export interface RecorderPairHandle {
  clockOrigin: number;
  /** Resolves once both recorders have flushed their final chunk. */
  stopAll: () => Promise<void>;
  /** Stops only the tab recorder — for the revoked-share flow (plan 04-05). */
  stopTab: () => void;
  pause: () => void;
  resume: () => void;
}

/** Chunk metadata for one delivered chunk, minus the session it belongs to. */
export type RecorderChunkMeta = Omit<AudioChunkMeta, "sessionId">;

export function startRecorderPair(
  micStream: MediaStream,
  tabStream: MediaStream,
  roleMap: { mic: StreamRole; tab: StreamRole },
  onChunk: (meta: RecorderChunkMeta, blob: Blob) => void,
  mimeType: string
): RecorderPairHandle {
  const clockOrigin = performance.now(); // single shared clock for both recorders

  let micSeq = 0;
  let tabSeq = 0;

  const micRecorder = new MediaRecorder(micStream, { mimeType });
  micRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      onChunk(
        {
          streamRole: roleMap.mic,
          seq: micSeq++,
          tsMs: performance.now() - clockOrigin,
          size: e.data.size,
          mimeType,
        },
        e.data
      );
    }
  };

  const tabRecorder = new MediaRecorder(tabStream, { mimeType });
  tabRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      onChunk(
        {
          streamRole: roleMap.tab,
          seq: tabSeq++,
          tsMs: performance.now() - clockOrigin,
          size: e.data.size,
          mimeType,
        },
        e.data
      );
    }
  };

  micRecorder.start(TIMESLICE_MS);
  tabRecorder.start(TIMESLICE_MS);

  // A clean stop must not lose the tail: wait for each recorder's own "stop"
  // event, which fires only after its final dataavailable has dispatched.
  const waitForStop = (recorder: MediaRecorder) =>
    new Promise<void>((resolve) => {
      if (recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });

  return {
    clockOrigin,
    stopAll: async () => {
      const micDone = waitForStop(micRecorder);
      const tabDone = waitForStop(tabRecorder);
      if (micRecorder.state !== "inactive") micRecorder.stop();
      if (tabRecorder.state !== "inactive") tabRecorder.stop();
      await Promise.all([micDone, tabDone]);
    },
    stopTab: () => {
      if (tabRecorder.state !== "inactive") tabRecorder.stop();
    },
    pause: () => {
      if (micRecorder.state === "recording") micRecorder.pause();
      if (tabRecorder.state === "recording") tabRecorder.pause();
    },
    resume: () => {
      if (micRecorder.state === "paused") micRecorder.resume();
      if (tabRecorder.state === "paused") tabRecorder.resume();
    },
  };
}
