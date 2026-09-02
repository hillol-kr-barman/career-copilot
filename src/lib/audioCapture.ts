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
