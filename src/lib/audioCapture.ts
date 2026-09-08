/**
 * Microphone acquisition for the in-room capture path.
 *
 * One in-room microphone is the only acquisition path (D-21) — there is no
 * display capture and no second stream to route between roles.
 */

/**
 * Request the microphone with auto gain on (D-35): two voices at different
 * distances from one table mic arrive at very different levels, and AGC is
 * what keeps the far one from landing too quiet to transcribe. Echo
 * cancellation has no far-end signal to cancel on this path, and noise
 * suppression is tuned to preserve one near voice and can chew up the
 * other — both stay off. `deviceId` is applied as a constraint only when
 * supplied, defaulting to the system default microphone otherwise.
 */
export async function acquireMic(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      echoCancellation: false,
      noiseSuppression: false,
      ...(deviceId ? { deviceId } : {}),
    },
  });
}

/** Stops every track on a possibly-null stream. Safe to call more than once. */
export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Locked-reason copy when this browser exposes no usable recording path at all. */
export const CAPTURE_UNSUPPORTED_REASON =
  "This browser can't record audio at all — no supported recording format was found. Try a recent version of Chrome, Edge, Firefox, or Safari.";

/** Locked-reason copy when a prior attempt failed MIME negotiation. */
export const UNSUPPORTED_FORMAT_REASON =
  "This browser can't record audio in a supported format. Try updating your browser to the latest version.";

/**
 * Maps a caught acquisition/negotiation error to the exact Copywriting
 * Contract string. Capture errors are `DOMException`s and carry a usable
 * `.message`, but the raw browser message is never shown directly — the
 * mapped copy always names the fix, not just the failure.
 */
export function describeCaptureError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : undefined;

  if (name === "NotAllowedError") {
    return "Microphone access was blocked. Click the camera/mic icon in your browser's address bar, allow microphone access, then try again.";
  }
  if (name === "NotSupportedError") {
    return UNSUPPORTED_FORMAT_REASON;
  }
  if (err instanceof Error && /supported audio recording format/.test(err.message)) {
    return UNSUPPORTED_FORMAT_REASON;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong connecting the microphone.";
}
