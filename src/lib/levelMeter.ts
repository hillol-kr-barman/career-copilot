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

/**
 * The RMS level the D-37 pre-flight treats as "loud enough to transcribe".
 * A starting point, not a measured threshold (A3, LOW confidence, see
 * 04-RESEARCH.md) — three times 0.01, the near-silence threshold this was
 * originally derived from, which is a silence threshold and not an
 * audibility one. Kept in one place so it can be revised once real peak
 * numbers exist.
 */
export const PREFLIGHT_FLOOR_RMS = 0.03;

/**
 * How long a level must stay at or above `PREFLIGHT_FLOOR_RMS` before the
 * D-37 pre-flight latches a side as cleared. A starting point, not a
 * measured threshold — chosen to be long enough that a single loud
 * consonant can't pass the check on its own, short enough not to make the
 * operator hold a sentence.
 */
export const PREFLIGHT_SUSTAIN_MS = 300;

/** One side's rolling pre-flight measurement — the D-37 sample evaluator's state. */
export interface PreflightSampleState {
  /** The maximum level seen so far this side's attempt; never decreases. */
  peakLevel: number;
  /** Milliseconds this side has spent continuously at or above the floor. */
  sustainedMs: number;
  /** Latches true once `sustainedMs` first reaches the sustain threshold, and stays true regardless of later samples (D-37: a person who spoke and then stopped has still passed). */
  cleared: boolean;
}

/**
 * Pure, latching evaluator for one pre-flight sample (D-37). Touches no
 * browser global — importable and callable under Node, the same discipline
 * `computeRmsLevel` above already follows — and mutates neither `prev` nor
 * any module-level value, so calling it twice with the same arguments
 * returns equal results.
 *
 * A cleared state is a fixed point: once `cleared` is true, later samples
 * only ever raise `peakLevel`, never re-arm `sustainedMs` or un-clear the
 * result. Prior to that, any sample below `floor` resets the accumulated
 * `sustainedMs` to zero rather than merely pausing it — the sustain window
 * must be continuous.
 */
export function evaluatePreflightSample(
  prev: PreflightSampleState,
  level: number,
  sampleMs: number,
  floor: number,
  sustainMs: number,
): PreflightSampleState {
  const peakLevel = Math.max(prev.peakLevel, level);

  if (prev.cleared) {
    return { peakLevel, sustainedMs: prev.sustainedMs, cleared: true };
  }

  const sustainedMs = level >= floor ? prev.sustainedMs + sampleMs : 0;
  return { peakLevel, sustainedMs, cleared: sustainedMs >= sustainMs };
}
