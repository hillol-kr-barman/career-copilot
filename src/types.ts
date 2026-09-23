export interface ScoreRow {
  questionDescription: string;
  s: number; // Situation
  tE: number; // Task / Environment
  a: number; // Action
  rT: number; // Result / Technique
  starRating: number; // Avg of STAR
  cS: number; // Communication Style
  aE: number; // Adaptability or Expertise
  rA: number; // Analytical Reasoning
  competencyRating: number; // Avg of core competencies
}

export interface MetricRow {
  metric: string;
  value: string | number;
}

export interface StackingCardConfig {
  id: string;
  title: string;
  subtitle?: string;
  tag: string;
  colorTheme: {
    text: string;
    bg: string;
    border: string;
    gradient: string;
  };
}

export interface ResumeReportSection {
  tabName: string;
  title: string;
  content: string;
}

export interface ResumeReportData {
  body: string;
  tabSections: ResumeReportSection[];
  rawResponse?: string;
  modelUsed?: string;
}

/** One generated interview question paired with a model answer. */
export interface QAPair {
  question: string;
  answer: string;
  category: string;
  rationale: string;
}

export interface InterviewReportData {
  questionsText: string;
  evaluationText?: string;
}

/**
 * Inputs captured once at the top of the page and shared by all three tools,
 * so a resume is never uploaded more than once per session.
 *
 * Education is deliberately absent: it already lives in the resume, and the
 * prompts extract it from there rather than asking the candidate to retype it.
 */
export interface SharedContext {
  resumeText: string;
  resumeFileName: string;
  jobDescription: string;
  appliedPosition: string;
}

/** What a user's API key resolved to — detected, never chosen from a menu. */
export interface ProviderInfo {
  provider: "google" | "openai" | "anthropic";
  providerLabel: string;
  model: string;
}

/**
 * Which of the two people in the room a moment of audio or a tag press
 * belongs to (D-24). Replaces the retired `StreamRole`/`UserRole` split,
 * which existed only to express the retired mic-versus-tab mapping.
 */
export type Speaker = "candidate" | "interviewer";

/** Lifecycle of a Tool 4 capture session, from idle through stopped. */
export type CaptureStatus = "idle" | "connecting" | "armed" | "recording" | "paused" | "stopped";

/**
 * One `sessions` IndexedDB record. `clockOrigin` is the `performance.now()`
 * origin the tag track and the audio share — every chunk's `tsMs` and every
 * tag press's `tsMs` are measured from this one instant (D-22).
 */
export interface RecordingSession {
  sessionId: string;
  startedAt: number;
  clockOrigin: number;
  declaredSpeaker: Speaker;
  mimeType: string;
  status: "recording" | "stopped";
  durationMs: number;
  /**
   * The finished take's total byte size, recorded once after stop via
   * `updateSessionSize` so listing N takes never reads N takes' worth of
   * blobs. Optional and defaults to 0 for a record written before this field
   * existed (see `normaliseSessionRecord`).
   */
  sizeBytes?: number;
  /**
   * This take's transcription lifecycle (D-53). Absent means the take
   * predates v3 entirely; `normaliseSessionRecord` defaults it to `"none"`.
   */
  transcriptStatus?: TranscriptStatus;
  /**
   * The D-55 opt-in: whether this take's audio survives past the D-52
   * retention pass once its transcript is complete and durable. Absent means
   * a pre-v3 take that predates the opt-in entirely; `normaliseSessionRecord`
   * defaults it to `true` so a retention pass can never delete audio the
   * operator never agreed to give up (D-32, D-43).
   */
  keepAudio?: boolean;
  /**
   * Whether this take's audio has already been deleted by the D-52/D-53
   * retention pass. Absent means audio has not been deleted;
   * `normaliseSessionRecord` defaults it to `false`.
   */
  audioDeleted?: boolean;
}

/** Metadata for one recorded chunk, without its payload. */
export interface AudioChunkMeta {
  sessionId: string;
  seq: number;
  tsMs: number;
  size: number;
  mimeType: string;
}

/** One `chunks` IndexedDB record — metadata plus the actual audio bytes. */
export interface AudioChunkRecord extends AudioChunkMeta {
  blob: Blob;
}

/** Aggregate stats for a session's stored chunks, for the download surface. */
export interface RecordingSummary {
  chunkCount: number;
  readableCount: number;
  totalBytes: number;
  durationMs: number;
}

/** One persisted spacebar press (D-27) — a fact about who started speaking, at what audio-elapsed offset. */
export interface TagPress {
  sessionId: string;
  tsMs: number;
  speaker: Speaker;
}

/** One derived contiguous speaker span (D-26) — the unit `deriveSpans` emits. */
export interface TagSpan {
  startMs: number;
  endMs: number;
  speaker: Speaker;
}

/** The D-30 JSON sidecar shape a take's tag track downloads as. */
export interface TagTrackSidecar {
  sessionId: string;
  mimeType: string;
  clockOrigin: number;
  startedAt: number;
  declaredSpeaker: Speaker;
  spans: TagSpan[];
}

/**
 * A take's transcription lifecycle (D-53). `"none"` is the absent-value
 * default for a pre-v3 take, which predates transcription entirely. `readSegments`
 * and the retention gate in plan 05-05 read this field to decide whether a
 * take's audio may be deleted.
 */
export type TranscriptStatus = "none" | "running" | "complete" | "incomplete";

/**
 * One `transcript` IndexedDB record — Whisper's own ~sentence granularity
 * (D-48), never a merged paragraph, because Phase 6's LIVE-16 needs a
 * verbatim quote as evidence for every sub-ask.
 *
 * `startMs`/`endMs` are absolute within the take, measured on the same
 * `clockOrigin` the tag track and every audio chunk already share
 * (`audioElapsedMs` in `src/lib/recorder.ts`) — this phase introduces no
 * second clock (D-48).
 *
 * `speaker` is what the tag track recorded for the window this segment came
 * from, and it is never rewritten once written (D-49) — the tag-track
 * partition stays immutable history. `resolvedSpeaker` is set only by a
 * LIVE-13 correction; every downstream read resolves attribution as
 * `resolvedSpeaker ?? speaker` rather than re-deriving it from spans.
 *
 * `windowStartMs` names the D-46 window this segment came out of, which is
 * what makes seam de-duplication (`dropSeamDuplicates`) possible across a
 * long span's sub-windows.
 */
export interface TranscriptSegment {
  sessionId: string;
  seq: number;
  startMs: number;
  endMs: number;
  speaker: Speaker;
  resolvedSpeaker?: Speaker;
  text: string;
  windowStartMs: number;
}

/** One unit of audio handed to the Whisper worker — a D-46 window, cut at tag-track span boundaries so it never carries two speakers. */
export interface TranscriptWindow {
  startMs: number;
  endMs: number;
  speaker: Speaker;
}

/**
 * The display and export unit (D-48: segments are stored fine, displayed by
 * turn). `corrected` is true when any member segment carries a
 * `resolvedSpeaker` override, so the UI and the LIVE-14 export can mark a
 * turn whose label was corrected.
 */
export interface TranscriptTurn {
  speaker: Speaker;
  startMs: number;
  endMs: number;
  segments: TranscriptSegment[];
  corrected: boolean;
}

// ---------------------------------------------------------------------------
// Phase 6 — the feedback document (LIVE-15..21). This is the architecture:
// later plans in this phase fill fields (D-73's ScoreRow, D-69's resume
// findings, D-65's rollups) but do not reshape these shapes.
// ---------------------------------------------------------------------------

/**
 * The four-value verdict a sub-ask is judged against (D-66). `DEFLECTED`
 * stays a separate value from `NOT_ADDRESSED` — a candidate who visibly
 * dodged a question is a different finding from one who was simply never
 * asked to answer it, and collapsing the two would erase that distinction
 * from every downstream rollup.
 */
export type Coverage = "ADDRESSED" | "PARTIAL" | "NOT_ADDRESSED" | "DEFLECTED";

/**
 * Whether a sub-ask was actually asked out loud, or is implied by the job
 * description against a question that never named it (D-65). The
 * silent-gaps headline (LIVE-17) collects only `"asked"` sub-asks; an
 * `"implied_by_jd"` sub-ask that was never addressed is a missed follow-up
 * (LIVE-18) instead, a different claim about the candidate.
 */
export type SubAskSource = "asked" | "implied_by_jd";

/**
 * One discrete thing a complete answer to an exchange's question must cover
 * (LIVE-15). `evidenceQuote` is the model's claimed verbatim quote from the
 * candidate's own words; `evidenceSegmentSeq`/`evidenceStartMs` are resolved
 * by `src/lib/quoteMatcher.ts` against the stored transcript, never
 * model-authored (Pattern 2) — a match sets them, a miss leaves them
 * `undefined` and sets `quoteUnverified` (D-66).
 */
export interface SubAsk {
  text: string;
  source: SubAskSource;
  coverage: Coverage;
  evidenceQuote: string;
  /** Resolved by the quote matcher on a match. Never model-authored. */
  evidenceSegmentSeq?: number;
  /** Resolved by the quote matcher on a match. Never model-authored. */
  evidenceStartMs?: number;
  /** True when `evidenceQuote` matched no stored segment (D-66) — the
   * verdict has already been downgraded from `ADDRESSED` to `PARTIAL` by the
   * time this is set; the document states no quotable evidence was found. */
  quoteUnverified: boolean;
  assessment: string;
  whatAGoodAnswerWouldHaveIncluded: string;
}

/**
 * One substantive interviewer question and its decomposition (D-64: only
 * questions a candidate can be judged on become exchanges — greetings,
 * scheduling and closing pleasantries produce none). `startMs`/`endMs` are
 * resolved by matching `questionText`/`answerText` against interviewer- and
 * candidate-attributed segments respectively (Pattern 2) — never asked of
 * the model, for the same reason a quote's segment reference never is.
 */
export interface Exchange {
  exchangeIndex: number;
  questionText: string;
  questionIntent: string;
  answerText: string;
  subAsks: SubAsk[];
  /** Resolved by matching `questionText` against interviewer segments. Never model-authored. */
  startMs?: number;
  /** Resolved by matching `answerText` against candidate segments. Never model-authored. */
  endMs?: number;
  /** D-73: the seven raw `ScoreRow` fields plus the two derived averages,
   * populated by a later plan in this phase. `ScoreRow` itself is untouched. */
  scoreRow?: ScoreRow;
  /** D-73's open risk: a STAR read only applies where the question actually
   * calls for one. A later plan renders the STAR read only when this is true. */
  starApplicable: boolean;
  starNote: string;
}

/**
 * A candidate's spoken claim that may not square with their resume (D-69).
 * Reported only when both sides are quoted — `spokenQuote` must pass the
 * same quote-matcher verification as a sub-ask's `evidenceQuote` before this
 * finding is ever shown; a later plan enforces that gate.
 */
export interface ResumeConsistencyFinding {
  spokenQuote: string;
  /** Resolved by the quote matcher on a match. Never model-authored. */
  spokenSegmentSeq?: number;
  /** Resolved by the quote matcher on a match. Never model-authored. */
  spokenStartMs?: number;
  resumeLine: string;
  note: string;
}

/** One job-description requirement and whether the interview ever produced evidence for it (LIVE-19). */
export interface JdCoverageItem {
  requirement: string;
  evidenced: boolean;
}

/**
 * The stored, generated document for one take (D-72 — persisted in
 * IndexedDB by a later plan). `transcriptFingerprint` is
 * `fingerprintSegments(segments)` at generation time, the input a later
 * plan's staleness check compares against a live re-fingerprint after a
 * D-51 speaker correction.
 */
export interface FeedbackDocument {
  sessionId: string;
  generatedAt: number;
  modelUsed?: string;
  provider?: string;
  transcriptFingerprint: string;
  exchanges: Exchange[];
  resumeConsistency: ResumeConsistencyFinding[];
  jdCoverage: JdCoverageItem[];
  strengths: string;
  priorityImprovements: string;
  /** How many delivery-related remarks the D-67/D-68 server-side screen withheld from this document. */
  withheldRemarkCount: number;
}

/** D-62's progress state for the two-call pipeline behind one button. */
export type FeedbackStage = "idle" | "structuring" | "judging" | "done";
