/**
 * Live audio level metering.
 *
 * The browser already computes the frequency/time-domain analysis natively
 * via `AnalyserNode` — the only thing worth writing here is the reduction
 * over the samples it returns, and that reduction is kept pure and
 * side-effect-free so it can be tested without an `AudioContext` at all
 * (Phase 7).
 */

/**
 * Root mean square of a buffer of time-domain audio samples, clamped to 1.
 * Pure — touches no browser global, returns 0 for a zero-length input, and
 * is importable and callable in isolation without any acquisition step.
 */
export function computeRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sumOfSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumOfSquares += samples[i] * samples[i];
  }

  return Math.min(1, Math.sqrt(sumOfSquares / samples.length));
}

/** A live level-meter reader for one already-acquired `MediaStream`. */
export interface LevelMeterHandle {
  /** Current RMS level, 0 to 1, freshly read on each call. */
  read: () => number;
  /** Tears down the analysis graph and releases the audio resources it holds. */
  close: () => void;
}

/**
 * Wraps a `MediaStream` in a native browser analysis graph purely for
 * observability — metering is never a recording dependency. Construction
 * failure (no support, an exhausted resource, a track the browser refuses to
 * source from) returns `null` rather than throwing, so a meter failure can
 * never block or interrupt a recording in progress.
 */
export function createLevelMeter(stream: MediaStream): LevelMeterHandle | null {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    // Reused across every read — avoids allocating a new typed array per
    // animation frame.
    const buffer = new Float32Array(analyser.fftSize);

    return {
      read: () => {
        analyser.getFloatTimeDomainData(buffer);
        return computeRmsLevel(buffer);
      },
      close: () => {
        source.disconnect();
        analyser.disconnect();
        void audioContext.close().catch(() => {
          // Already closed or closing — nothing further to clean up.
        });
      },
    };
  } catch {
    return null;
  }
}

/** RMS level below which a stream is treated as near-silent (the silence watchdog threshold). */
export const NEAR_SILENCE_RMS = 0.01;

/** Grace period after recording starts before the silence watchdog can arm. */
export const SILENCE_GRACE_MS = 5000;

/** Continuous near-silence duration on the tab stream that raises the silence-watchdog notice. */
export const SILENCE_WATCHDOG_MS = 15000;
