/**
 * Local statistical AI-text detector.
 *
 * Runs entirely in-process: no API key, no external call, no model. It combines
 * linguistic signals, each normalised to [0, 1] where 1 is more AI-like, into a
 * single weighted composite.
 *
 * What this is and is not
 * -----------------------
 * This is a heuristic over surface features, not a classifier trained on
 * labelled data. It can say "this reads like LLM output"; it cannot prove
 * authorship. Every signal here is defeated by a person who writes formally, or
 * by an LLM asked to write plainly. Treat the number as a prompt to look
 * closer, never as a verdict about a candidate.
 *
 * Signal selection is deliberate. Two signals that the earlier version weighted
 * were measured to carry no information for resume-register text and were
 * removed rather than left in as noise — see VOCABULARY RICHNESS below.
 */

export interface DetectorSignals {
  /** Sentence-length variation. Uniform sentences read as AI. */
  burst: number;
  /** Density of LLM-hallmark phrases. */
  phrase: number;
  /** Density of formal connectors ("furthermore", "consequently"). */
  transition: number;
  /** Average sentence length, peaked over the range LLMs favour. */
  sentLen: number;
  /** Absence of em-dashes, ellipses, parentheses and slashes. */
  punct: number;
}

export interface DetectionResult {
  /** Composite AI-likelihood in [0, 1]. */
  score: number;
  signals: DetectorSignals;
  /** Word count actually scored, for the caller's logs. */
  words: number;
}

/**
 * VOCABULARY RICHNESS (type-token ratio) was removed, not merely down-weighted.
 *
 * Measured across human- and LLM-written resume samples, TTR does not separate
 * them at all — both cluster around 0.81 on a 100-word moving average. Worse,
 * the raw ratio the earlier version used is length-dependent: it reaches 1.00
 * for any text under ~40 words, and bullet-structured resumes never repeat
 * words, so genuine human resumes saturated the signal and were pushed toward
 * "AI". It contributed a systematic penalty to exactly the input this tool is
 * aimed at, in exchange for no discriminating power.
 *
 * BURSTINESS is kept but weighted low: measured separation between human and
 * LLM resume text was ~0.06, close to noise. It earns its place only because it
 * is one of the few signals that still works on long prose.
 */

/**
 * Phrases disproportionately common in LLM output.
 *
 * Deliberately excludes ordinary professional vocabulary. The earlier list
 * contained `emphasize`, `underscores`, `tailored to` and `leverage <x>` —
 * standard resume register, and three of them fired on hand-written resumes,
 * saturating the heaviest-weighted signal in the whole detector and pushing
 * real candidates into "Mixed signals".
 *
 * Also excludes connectors that appear in TRANSITIONS below (furthermore,
 * moreover, additionally, nevertheless), which were being counted twice.
 */
const AI_PHRASES: RegExp[] = [
  /\bI am an AI\b/i,
  /\bas an AI( language model)?\b/i,
  /\bit(?:'s| is) worth noting\b/i,
  /\bit(?:'s| is) important to (note|mention|highlight|emphasize)\b/i,
  /\bin (today's|the modern) (world|landscape|era)\b/i,
  /\bfeel free to\b/i,
  /\bcertainly[,!]/i,
  /\bof course[,!]/i,
  /\bAbsolutely[,!]/i,
  /\bI(?:'d| would) be happy to\b/i,
  /\bIn conclusion[,]/i,
  /\bIn summary[,]/i,
  /\bTo summarize[,]/i,
  /\bFirstly[,]/i,
  /\bSecondly[,]/i,
  /\bLastly[,]/i,
  /\bNotwithstanding\b/i,
  /\bdelve into\b/i,
  /\bfoster (a|an|the)?\s*(culture|environment|sense)\b/i,
  /\bseamlessly\b/i,
  /\brobust (solution|framework|approach|system)\b/i,
  /\bcomprehensive (overview|guide|approach|solution)\b/i,
  /\bstate-of-the-art\b/i,
  /\bcutting-edge\b/i,
  /\bparadigm\b/i,
];

/** Formal connectors that LLMs over-use to stitch paragraphs together. */
const TRANSITIONS = [
  "however", "therefore", "furthermore", "moreover", "additionally",
  "consequently", "subsequently", "nevertheless", "nonetheless",
  "in addition", "as a result", "on the other hand", "in contrast",
  "for instance", "for example", "in particular", "specifically",
  "notably", "importantly", "significantly",
];

/** Precompiled once: rebuilding these per call scanned the input 20 extra times. */
const TRANSITION_PATTERNS = TRANSITIONS.map((t) => new RegExp(`\\b${t}\\b`, "g"));

/** Number of hallmark phrases that saturates the signal. */
const PHRASE_SATURATION = 4;

/**
 * Weights. Chosen from measured separation between human- and LLM-written
 * resume samples, not from intuition: phrase and transition density carry
 * almost all of the signal, punctuation carries some, and sentence statistics
 * carry very little.
 */
const WEIGHTS: Record<keyof DetectorSignals, number> = {
  phrase: 0.38,
  transition: 0.32,
  punct: 0.16,
  burst: 0.08,
  sentLen: 0.06,
};

/**
 * Average sentence length, scored against the range LLMs favour.
 *
 * The earlier version's comments and code disagreed: the comments described a
 * peak of 18-28 words and human-like extremes below 12 or above 35, but the
 * code tested 16-30 and dropped everything outside it to a flat 0.2 cliff. This
 * implements the documented intent, with a linear ramp instead of the cliff.
 */
function sentenceLengthScore(avgLen: number): number {
  if (avgLen >= 18 && avgLen <= 28) return 1;
  if (avgLen < 18) {
    return avgLen <= 12 ? 0.2 : 0.2 + ((avgLen - 12) / 6) * 0.8;
  }
  return avgLen >= 35 ? 0.2 : 1 - ((avgLen - 28) / 7) * 0.8;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function detectAiStatistically(text: string): DetectionResult {
  const sentences = text
    .replace(/([.?!])\s+/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const words = text.toLowerCase().match(/\b[a-z']+\b/g) ?? [];
  const totalWords = words.length || 1;

  // ── Burstiness: sentence-length coefficient of variation ─────────────────
  // Human writing varies more. Low variation reads as machine-generated.
  let burst = 0.5;
  if (sentences.length >= 3) {
    const lens = sentences.map((s) => s.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
    const cv = Math.sqrt(variance) / (mean || 1);
    burst = clamp01(1 - cv / 0.6);
  }

  // ── AI hallmark phrases ──────────────────────────────────────────────────
  const phraseHits = AI_PHRASES.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
  const phrase = Math.min(1, phraseHits / PHRASE_SATURATION);

  // ── Transition-word density, per 100 words ───────────────────────────────
  const lowerText = text.toLowerCase();
  let transitionCount = 0;
  for (const p of TRANSITION_PATTERNS) {
    transitionCount += (lowerText.match(p) ?? []).length;
  }
  const transition = Math.min(1, transitionCount / (totalWords / 100) / 4);

  // ── Average sentence length ──────────────────────────────────────────────
  const sentLen = sentences.length > 0 ? sentenceLengthScore(totalWords / sentences.length) : 0.3;

  // ── Punctuation ──────────────────────────────────────────────────────────
  // Em-dashes, ellipses, parentheses and slashes are strong evidence a human
  // wrote it; their absence is only weak evidence of the reverse, since plenty
  // of human resumes use none. Capped well below 1 so plain formatting alone
  // can never carry a document toward "AI" the way it previously did.
  const humanPunct = (text.match(/[—–…()/]/g) ?? []).length;
  const punctDensity = humanPunct / (totalWords / 100);
  const punct = clamp01(0.65 * (1 - punctDensity / 3));

  const signals: DetectorSignals = { burst, phrase, transition, sentLen, punct };

  const score = clamp01(
    (Object.keys(WEIGHTS) as Array<keyof DetectorSignals>).reduce(
      (sum, k) => sum + signals[k] * WEIGHTS[k],
      0
    )
  );

  return { score, signals, words: words.length };
}
