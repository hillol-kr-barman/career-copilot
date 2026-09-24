/**
 * Microphone acquisition for the in-room capture path.
 *
 * One in-room microphone is the only acquisition path (D-21) — there is no
 * display capture and no second stream to route between roles.
 */

/** One labelled audio-input device the browser reports, for the D-36 picker. */
export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/**
 * Shown when the operator's chosen device could not be honoured — a
 * disappeared or busy device — and the request fell back to the system
 * default instead. The substitution must always be visible on screen (D-36);
 * this string is what makes it so, rather than a silent fallback.
 */
export const DEVICE_FALLBACK_NOTICE =
  "The selected microphone wasn't available, so this recording is using the system default microphone instead.";

/**
 * Every audio-input device the browser currently reports, labelled and ready
 * for the D-36 picker. Call only after microphone permission has been
 * granted — before that, every label the browser returns is blank, which
 * would give the operator a list of indistinguishable rows. Degrades to an
 * empty array on any failure, the same discipline the rest of this file uses
 * for a read the UI can live without. A device with no label (should not
 * happen post-permission, but not guaranteed) gets a positional fallback name
 * so a row is never blank.
 */
export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

/** The result of one `acquireMic` call — whether the requested device was actually honoured. */
export interface AcquireMicResult {
  stream: MediaStream;
  /** True when `deviceId` was supplied but could not be honoured, and the request fell back to the system default (D-36). */
  usedFallback: boolean;
}

/**
 * D-35's three constraint booleans, applied identically on every microphone
 * request this file makes, including a retry after an over-constrained
 * failure. `deviceId` is applied as an **exact** constraint, not a
 * preference — a preference lets the browser silently hand back a different
 * microphone than the one the operator chose, which is precisely the failure
 * the D-36 picker exists to prevent.
 */
function micConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    autoGainControl: true,
    echoCancellation: false,
    noiseSuppression: false,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

/**
 * Request the microphone with auto gain on (D-35): two voices at different
 * distances from one table mic arrive at very different levels, and AGC is
 * what keeps the far one from landing too quiet to transcribe. Echo
 * cancellation has no far-end signal to cancel on this path, and noise
 * suppression is tuned to preserve one near voice and can chew up the
 * other — both stay off.
 *
 * `deviceId`, when supplied, is applied as an exact constraint (D-36). If
 * that request fails with the browser's over-constrained error — the device
 * has disappeared or is otherwise unusable — this retries once with no
 * device constraint at all, keeping the same D-35 booleans, and reports the
 * substitution through `usedFallback` so the caller can surface it rather
 * than silently substituting a different microphone.
 */
export async function acquireMic(deviceId?: string): Promise<AcquireMicResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
    return { stream, usedFallback: false };
  } catch (err) {
    if (deviceId && err instanceof DOMException && err.name === "OverconstrainedError") {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints(undefined),
      });
      return { stream, usedFallback: true };
    }
    throw err;
  }
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
