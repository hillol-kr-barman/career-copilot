/**
 * Microphone and tab-audio acquisition.
 *
 * The one non-obvious platform fact that motivates this module: Chrome
 * rejects an audio-only display-capture request outright — requesting
 * `{ audio: true, video: false }` throws `NotSupportedError` — so `video`
 * must always be requested too, and its track stopped immediately once the
 * stream resolves.
 */

/**
 * Request the microphone as a raw, unprocessed stream. Echo cancellation,
 * noise suppression and auto gain are all disabled — the raw signal is what
 * Phase 5's transcription step needs, not a browser-cleaned one.
 */
export async function acquireMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

/**
 * Request the shared tab as a display-capture stream, preferring tab audio
 * over OS-wide system audio (D-04). `systemAudio` and `selfBrowserSurface`
 * are Chrome-specific constraints not present in the DOM lib types, hence
 * the cast.
 *
 * `hasAudio: false` means the visitor shared a tab without ticking "Share
 * tab audio" — the picker still resolves successfully, so the returned
 * stream's track list is the only reliable signal.
 */
export async function acquireTabAudio(): Promise<{ stream: MediaStream; hasAudio: boolean }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true, // required by Chrome even for audio-only intent
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: "exclude", // prefer tab audio over OS-wide audio (D-04)
    selfBrowserSurface: "exclude", // keep this tab out of the share picker
  } as DisplayMediaStreamOptions);

  const hasAudio = stream.getAudioTracks().length > 0;

  // The video track exists only to satisfy Chrome's constraint requirement —
  // stop it immediately so no video frame is ever processed and the
  // browser's sharing indicator reflects reality as closely as it can.
  for (const track of stream.getVideoTracks()) track.stop();

  return { stream, hasAudio };
}

/** Stops every track on a possibly-null stream. Safe to call more than once. */
export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Locked-reason copy when this browser cannot do tab-audio capture at all
 * (D-01, D-05).
 */
export const TAB_AUDIO_UNSUPPORTED_REASON =
  "Live Interview capture needs a Chromium-based browser — Chrome, Edge, or Brave — to share the interviewer's tab audio. This browser doesn't support that yet, so recording is disabled here rather than producing a silent file for the other person. Open this page in Chrome or Edge to record.";

/** Locked-reason copy when a prior attempt failed MIME negotiation. */
export const UNSUPPORTED_FORMAT_REASON =
  "This browser can't record audio in a supported format. Try updating Chrome or Edge to the latest version.";

/**
 * A soft, pre-acquisition heuristic — presence of `getDisplayMedia` proves
 * nothing here. Firefox and Safari both expose `mediaDevices.getDisplayMedia`
 * but silently drop the audio constraint, so this is a user-agent family
 * check for the UI copy, not a hard gate; the real check is the
 * post-acquisition `getAudioTracks().length` read in `acquireTabAudio` (D-05).
 */
export function isTabAudioLikelySupported(): boolean {
  const ua = navigator.userAgent;
  const isChromiumFamily = /Chrome|Chromium|Edg\//.test(ua) && !/Firefox/.test(ua);
  return typeof navigator.mediaDevices?.getDisplayMedia === "function" && isChromiumFamily;
}

/**
 * Maps a caught acquisition/negotiation error to the exact Copywriting
 * Contract string. Capture errors are `DOMException`s and carry a usable
 * `.message`, but the raw browser message is never shown directly — the
 * mapped copy always names the fix, not just the failure.
 */
export function describeCaptureError(err: unknown, source: "mic" | "display"): string {
  const name = err instanceof DOMException ? err.name : undefined;

  if (name === "NotAllowedError" && source === "mic") {
    return "Microphone access was blocked. Click the camera/mic icon in your browser's address bar, allow microphone access, then try again.";
  }
  if (name === "NotAllowedError" || name === "AbortError") {
    return "You closed the sharing picker without choosing a tab. Click 'Connect microphone & screen' again and pick the tab or window with your call.";
  }
  if (name === "NotSupportedError") {
    return UNSUPPORTED_FORMAT_REASON;
  }
  if (err instanceof Error && /supported audio recording format/.test(err.message)) {
    return UNSUPPORTED_FORMAT_REASON;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong connecting the microphone and screen.";
}
