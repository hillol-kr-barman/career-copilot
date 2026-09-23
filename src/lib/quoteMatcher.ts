import type { TranscriptSegment } from "../types";

/**
 * The shared quote-verification primitive for D-66 (evidence quotes), D-60
 * (the segment reference the click target scrolls to), exchange boundary
 * resolution (Pattern 2 — the model is never asked for a timestamp), and
 * D-69 (resume-consistency spoken claims). Pure — touches no browser
 * global — so `scripts/check-tag-track.ts` can import and assert it under
 * Node, the same discipline `transcriptTurns.ts` follows.
 *
 * Every function here is total: a malformed or empty input returns a safe
 * default, never a throw. "No quote, no credit" (D-66) is enforced by
 * treating a match failure as data, not an exceptional condition.
 */

/**
 * Normalises text for matching: lowercases, folds curly quotes and en/em
 * dashes to their ASCII equivalents, collapses whitespace runs to a single
 * space, and trims. Applied to both the candidate quote and the source
 * transcript text before comparison, so casing and Whisper's own
 * transcription-time punctuation choices never cause a false miss.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The result of resolving a claimed quote against stored transcript segments. */
export interface QuoteMatch {
  matched: boolean;
  segmentSeq?: number;
  startMs?: number;
}

/**
 * Resolves `quote` against `segments` with normalized exact-substring
 * matching — no fuzzy/edit-distance tolerance (D-66: a miss must downgrade
 * the verdict, not silently near-match). Beyond `normalizeForMatch`, a
 * narrow set of leading/trailing punctuation (`"'.,!?;:`) is stripped from
 * the quote only — never from the source text, since Whisper's own
 * punctuation inside a sentence should not be altered before matching.
 *
 * Segments are sorted by `startMs` then `seq` and their normalized text
 * concatenated with a single space between each (mirroring
 * `formatTranscriptText`'s own join), tracking each segment's `[from, to)`
 * offset range in the concatenated string. The match resolves to the
 * segment whose offset range contains the match's start index — the
 * earliest occurrence in the concatenation wins, which is both the
 * deterministic tie-break for a repeated phrase and the correct owner for a
 * quote whose tail extends into the next segment.
 *
 * Returns `{ matched: false }` for an empty quote, a whitespace/punctuation-
 * only quote, or an empty segment array. Never throws.
 */
export function findQuoteInSegments(quote: string, segments: TranscriptSegment[]): QuoteMatch {
  const normalizedQuote = normalizeForMatch(quote).replace(/^["'.,!?;:]+|["'.,!?;:]+$/g, "");
  if (!normalizedQuote) return { matched: false };
  if (segments.length === 0) return { matched: false };

  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);

  const offsets: { seq: number; startMs: number; from: number; to: number }[] = [];
  let concatenated = "";
  for (const segment of sorted) {
    const normSegText = normalizeForMatch(segment.text);
    if (!normSegText) continue;
    if (concatenated.length > 0) concatenated += " ";
    const from = concatenated.length;
    concatenated += normSegText;
    offsets.push({ seq: segment.seq, startMs: segment.startMs, from, to: concatenated.length });
  }

  if (offsets.length === 0) return { matched: false };

  const idx = concatenated.indexOf(normalizedQuote);
  if (idx === -1) return { matched: false };

  const owner = offsets.find((o) => idx >= o.from && idx < o.to) ?? offsets[offsets.length - 1];
  return { matched: true, segmentSeq: owner.seq, startMs: owner.startMs };
}

/**
 * A stable, order-independent digest of a segment list — the input a later
 * plan's staleness check (D-51: a speaker correction landing after a
 * document was generated) compares against a fresh re-fingerprint. Built
 * from each segment's `seq`, its resolved speaker (`resolvedSpeaker ??
 * speaker`, D-49 — never re-derived from spans), and its trimmed text,
 * sorted by `seq` before joining so segment order in the input array never
 * changes the result. Different when any segment's resolved speaker or text
 * changes; identical otherwise, including across repeated calls and
 * reordered input. Never throws; an empty array yields a stable, defined
 * digest of its own.
 */
export function fingerprintSegments(segments: TranscriptSegment[]): string {
  const sorted = [...segments].sort((a, b) => a.seq - b.seq);
  return sorted
    .map((segment) => `${segment.seq}:${segment.resolvedSpeaker ?? segment.speaker}:${segment.text.trim()}`)
    .join("|");
}
