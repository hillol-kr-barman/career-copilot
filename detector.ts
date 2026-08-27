/**
 * Local statistical AI-text detector.
 *
 * Runs entirely in-process: no API key, no external call, no model.
 */

// ---------------------------------------------------------------------------
// Local statistical AI text detector
// Combines 6 linguistic signals. Each returns a score in [0, 1] where 1 = more AI-like.
// Weights are tuned empirically for resume/professional text.
// ---------------------------------------------------------------------------
export function detectAiStatistically(text: string): number {

  // ── helpers ──────────────────────────────────────────────────────────────
  const sentences = text
    .replace(/([.?!])\s+/g, "$1\n")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 5);

  const words = text.toLowerCase().match(/\b[a-z']+\b/g) ?? [];
  const totalWords = words.length || 1;

  // ── Signal 1: Burstiness (sentence-length coefficient of variation) ──────
  // Human writing is more "bursty" (varied). AI tends to be uniform.
  // Low CoV → more AI-like.
  let burstScore = 0.5;
  if (sentences.length >= 3) {
    const lens = sentences.map(s => s.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
    const cv = Math.sqrt(variance) / (mean || 1);
    // cv > 0.6 → human-like; cv < 0.25 → AI-like
    burstScore = Math.max(0, Math.min(1, 1 - (cv / 0.6)));
  }

  // ── Signal 2: Vocabulary richness (type-token ratio) ────────────────────
  // AI can be unusually rich (diverse vocab) or repetitive. We compare to
  // a typical human TTR of ~0.55 for 200-word samples. Very high TTR is AI-like.
  const uniqueWords = new Set(words).size;
  const ttr = uniqueWords / totalWords;
  // ttr > 0.72 is suspiciously high; scale linearly
  const ttrScore = Math.max(0, Math.min(1, (ttr - 0.45) / 0.35));

  // ── Signal 3: AI hallmark phrases ───────────────────────────────────────
  // Phrases disproportionately common in LLM output.
  const aiPhrases = [
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
    /\bFurthermore[,]/i,
    /\bMoreover[,]/i,
    /\bAdditionally[,]/i,
    /\bNevertheless[,]/i,
    /\bNotwithstanding\b/i,
    /\bdelve into\b/i,
    /\bfoster (a|an|the)?\s*(culture|environment|sense)\b/i,
    /\bleverage (your|our|my|the|their)?\s*\w+/i,
    /\btailored (to|for)\b/i,
    /\bseamlessly\b/i,
    /\brobust (solution|framework|approach|system)\b/i,
    /\bcomprehensive (overview|guide|approach|solution)\b/i,
    /\bstate-of-the-art\b/i,
    /\bcutting-edge\b/i,
    /\bparadigm\b/i,
    /\bemphasize\b/i,
    /\bunderscores?\b/i,
  ];
  const phraseHits = aiPhrases.filter(p => p.test(text)).length;
  const phraseScore = Math.min(1, phraseHits / 5);

  // ── Signal 4: Transition word density ───────────────────────────────────
  // AI tends to over-use formal connectors.
  const transitions = [
    "however", "therefore", "furthermore", "moreover", "additionally",
    "consequently", "subsequently", "nevertheless", "nonetheless",
    "in addition", "as a result", "on the other hand", "in contrast",
    "for instance", "for example", "in particular", "specifically",
    "notably", "importantly", "significantly",
  ];
  let transitionCount = 0;
  const lowerText = text.toLowerCase();
  for (const t of transitions) transitionCount += (lowerText.match(new RegExp(`\\b${t}\\b`, "g")) ?? []).length;
  const transitionDensity = transitionCount / (totalWords / 100); // per 100 words
  const transitionScore = Math.min(1, transitionDensity / 4);     // 4+ per 100 = fully AI-like

  // ── Signal 5: Average sentence length ───────────────────────────────────
  // AI often writes slightly longer, well-formed sentences (18-26 words).
  // Very short (<12) or very long (>35) are more human-like extremes.
  let sentLenScore = 0.3;
  if (sentences.length > 0) {
    const avgLen = words.length / sentences.length;
    // Peak AI range: 18-28 words/sentence
    sentLenScore = avgLen >= 16 && avgLen <= 30
      ? Math.min(1, (avgLen - 10) / 20)
      : 0.2;
  }

  // ── Signal 6: Punctuation uniformity ────────────────────────────────────
  // AI text rarely uses em-dashes, ellipses, or parenthetical asides.
  const humanPunct = (text.match(/[—–…()/]/g) ?? []).length;
  const humanPunctDensity = humanPunct / (totalWords / 100);
  const punctScore = Math.max(0, 1 - humanPunctDensity / 3); // 3+ per 100 → human-like

  // ── Weighted combination ─────────────────────────────────────────────────
  const weights = {
    burst: 0.20,
    ttr: 0.10,
    phrase: 0.30,
    transition: 0.20,
    sentLen: 0.10,
    punct: 0.10,
  };

  const composite =
    burstScore      * weights.burst +
    ttrScore        * weights.ttr +
    phraseScore     * weights.phrase +
    transitionScore * weights.transition +
    sentLenScore    * weights.sentLen +
    punctScore      * weights.punct;

  console.log(`[ai-detect] scores — burst:${burstScore.toFixed(2)} ttr:${ttrScore.toFixed(2)} phrase:${phraseScore.toFixed(2)} transition:${transitionScore.toFixed(2)} sentLen:${sentLenScore.toFixed(2)} punct:${punctScore.toFixed(2)} → composite:${composite.toFixed(2)}`);

  return Math.max(0, Math.min(1, composite));
}
