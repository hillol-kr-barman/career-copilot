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
