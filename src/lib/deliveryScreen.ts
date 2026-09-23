/**
 * The D-67 layer-2 delivery-scoring screen and D-68's disclosure marker.
 * Pure — touches no browser global — so `scripts/check-tag-track.ts` can
 * import and assert it under Node, the same discipline `transcriptTurns.ts`
 * and `transcriptText.ts` follow.
 *
 * This is enforcement, not a rendering concern. `server.ts` runs
 * `screenDeliveryProse` inside the `/api/interview/live-feedback` route
 * handler itself, because LIVE-21 is named in `REQUIREMENTS.md`'s Out of
 * Scope table as a fairness requirement — scoring accent, fluency, pace,
 * filler words or confidence discriminates against non-native and disabled
 * candidates — and a prompt instruction alone is a soft guarantee from a
 * model. A client that only checked this on the way in, or skipped it
 * entirely, would defeat the requirement outright; running it on the server,
 * between the model's response and the caller, closes that gap regardless of
 * which client calls the route directly.
 */

/**
 * D-67's accepted tradeoff, stated plainly: this screen is imperfect and
 * will occasionally trip on a legitimate phrase. CONTEXT.md's own example of
 * that risk is a sentence describing a claim as confident — "a confident
 * claim about the migration" reads as content commentary, not delivery
 * commentary, and still contains the term "confident". That false positive
 * is accepted deliberately: LIVE-21 is the one requirement in this phase
 * whose failure is a fairness problem rather than a quality problem, and a
 * false positive here is visible — D-68 guarantees the withheld marker says
 * a removal happened — while a false negative would ship a fairness breach
 * silently.
 *
 * Term-list review (backstop truth, plan 06-02): plan 06-01's checkpoint ran
 * this pipeline against a real interview and recorded two borderline
 * phrases the model actually produced — "briefly described" and "left the
 * thought incomplete" — neither of which trips any term below. Both were
 * reviewed and deliberately left out. "Briefly described" is a remark about
 * how much content the answer covered, not about the candidate's manner of
 * speaking; a term that caught it (e.g. "brief") would also catch a
 * legitimate, accurate PARTIAL/NOT_ADDRESSED judgement like "the candidate
 * briefly touched on caching but did not go into detail," which is exactly
 * the kind of content judgement this tool exists to make. "Left the thought
 * incomplete" was traced to a take that was stopped mid-utterance — the
 * model was describing a recording artefact, not the candidate — and no
 * term here would generalise to that case without also catching ordinary,
 * legitimate "the answer was incomplete" content verdicts. Recorded here,
 * and in the plan's own output SUMMARY, so the backstop truth is settled by
 * this record rather than left open.
 */
export const DELIVERY_TERMS: readonly string[] = [
  "accent",
  "accented",
  "fluent",
  "fluency",
  "articulate",
  "inarticulate",
  "um",
  "uh",
  "filler",
  "fillers",
  "pace",
  "paced",
  "pacing",
  "confident",
  "confidence",
  "unconfident",
  "nervous",
  "nervousness",
  "soft-spoken",
  "softly spoken",
  "stumble",
  "stumbled",
  "stutter",
  "stuttered",
  "mumble",
  "mumbled",
  "hesitant",
  "hesitation",
  "enunciate",
  "enunciation",
  "pronunciation",
  "mispronounce",
  "tone of voice",
  "inflection",
  "cadence",
  "verbal tic",
  "spoke quickly",
  "spoke slowly",
  "delivery",
];

/**
 * D-68: appended exactly once whenever `screenDeliveryProse` drops one or
 * more sentences, so a removal is never a silent rewrite. Whatever survives
 * beside it is untouched — this marker only ever announces a removal, it
 * never substitutes for the field's real content.
 */
export const WITHHELD_REMARK_MARKER =
  "[One remark about delivery was withheld — this tool judges content only.]";

/**
 * Every model-authored prose field in the Assess response that
 * `screenDeliveryProse` is applied to. `server.ts`'s live-feedback route
 * walks exactly these paths and no others (RESEARCH.md Pitfall 2 — screened
 * too broadly, a candidate's own words get mangled; too narrowly, a remark
 * slips through in a field nobody checked).
 *
 * Deliberately excluded, and why: `exchanges[].subAsks[].text` and
 * `exchanges[].subAsks[].source` are structural — a sub-ask's own text and
 * its asked/implied_by_jd tag, not a remark about the candidate.
 * `exchanges[].questionText`, `exchanges[].questionIntent` and
 * `exchanges[].answerText` are transcript-derived — a verbatim span or a
 * short description of what the interviewer asked, never the model's remark
 * about how the candidate spoke. `exchanges[].subAsks[].evidenceQuote` and
 * `resumeConsistency[].spokenQuote` / `resumeConsistency[].resumeLine` are
 * quoted source material — the candidate's or the resume's own words.
 * Screening any of these would let a speaker's own sentence be deleted as if
 * the model had written it.
 */
export const SCREENED_FIELD_PATHS: readonly string[] = [
  "exchanges[].subAsks[].assessment",
  "exchanges[].subAsks[].whatAGoodAnswerWouldHaveIncluded",
  "exchanges[].starNote",
  "resumeConsistency[].note",
  "strengths",
  "priorityImprovements",
];

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One word-boundary regex per term, built once at module load. A
// multi-word term (e.g. "tone of voice") matches across its internal single
// space because the pattern's literal text includes that space; the
// leading/trailing `\b` only requires a word/non-word transition at the
// phrase's own edges, so "paceable", "confidential" and "accentuate" never
// trip "pace", "confident" or "accent" — there is no such transition mid-word.
const DELIVERY_TERM_MATCHERS: RegExp[] = DELIVERY_TERMS.map(
  (term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i")
);

function sentenceNamesDeliveryTerm(sentence: string): boolean {
  return DELIVERY_TERM_MATCHERS.some((matcher) => matcher.test(sentence));
}

/**
 * Splits short model prose into sentences on the boundary after a full
 * stop, exclamation mark or question mark followed by whitespace. A string
 * with no terminal punctuation anywhere is returned as a single trimmed
 * element — there is nothing to split on, and returning it whole is safer
 * than guessing at a boundary. Empty and whitespace-only input return `[]`.
 * Never throws: malformed (non-string) input is treated as empty.
 */
export function splitSentences(text: string): string[] {
  const safeText = typeof text === "string" ? text : "";
  const trimmed = safeText.trim();
  if (!trimmed) return [];
  if (!/[.!?]/.test(trimmed)) return [trimmed];
  return trimmed
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** The result of screening one prose field: the (possibly edited) text, and how many sentences were withheld from it. */
export interface DeliveryScreenResult {
  text: string;
  withheldCount: number;
}

/**
 * Drops every sentence in `text` that names a prohibited delivery dimension
 * (D-67) and appends `WITHHELD_REMARK_MARKER` exactly once when anything was
 * dropped (D-68) — never a silent edit. A field with no offending sentence
 * is returned byte-identical, including its original whitespace, rather
 * than a rejoined reconstruction of it. When every sentence is dropped, the
 * result is the marker alone — never an empty string, because an empty
 * field is exactly the silent edit D-32 and D-68 forbid. Never throws:
 * malformed (non-string) input is treated as empty text with nothing
 * withheld.
 */
export function screenDeliveryProse(text: string): DeliveryScreenResult {
  const safeText = typeof text === "string" ? text : "";
  const sentences = splitSentences(safeText);
  if (sentences.length === 0) {
    return { text: safeText, withheldCount: 0 };
  }

  const survivors: string[] = [];
  let withheldCount = 0;
  for (const sentence of sentences) {
    if (sentenceNamesDeliveryTerm(sentence)) {
      withheldCount++;
    } else {
      survivors.push(sentence);
    }
  }

  if (withheldCount === 0) {
    // Nothing offended — return the original text untouched, not a
    // split/trimmed/rejoined reconstruction of it.
    return { text: safeText, withheldCount: 0 };
  }

  const rejoined = survivors.length > 0 ? `${survivors.join(" ")} ${WITHHELD_REMARK_MARKER}` : WITHHELD_REMARK_MARKER;
  return { text: rejoined, withheldCount };
}
