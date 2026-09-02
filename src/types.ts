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
 * Which physical audio source a recorder is attached to. This is a routing
 * label, never an identity — the mic track is whoever is at this laptop, the
 * tab track is whoever is on the call (D-06).
 */
export type StreamRole = "candidate" | "interviewer";

/** The visitor's own role in this interview — the single toggle from D-07. */
export type UserRole = "candidate" | "interviewer";

/** Lifecycle of a Tool 4 capture session, from idle through stopped. */
export type CaptureStatus = "idle" | "connecting" | "armed" | "recording" | "paused" | "stopped";

/**
 * One `sessions` IndexedDB record. `clockOrigin` is the shared
 * `performance.now()` origin both recorders' chunk timestamps are measured
 * from — this, not `startedAt`, is what lets Phase 5 merge the two streams
 * by time (D-03).
 */
export interface RecordingSession {
  sessionId: string;
  startedAt: number;
  clockOrigin: number;
  userRole: UserRole;
  mimeType: string;
  status: "recording" | "stopped";
  durationMs: number;
}

/** Metadata for one recorded chunk, without its payload. */
export interface AudioChunkMeta {
  sessionId: string;
  streamRole: StreamRole;
  seq: number;
  tsMs: number;
  size: number;
  mimeType: string;
}

/** One `chunks` IndexedDB record — metadata plus the actual audio bytes. */
export interface AudioChunkRecord extends AudioChunkMeta {
  blob: Blob;
}

/** Aggregate stats for one stream's stored chunks, for the download surface. */
export interface StreamSummary {
  role: StreamRole;
  chunkCount: number;
  readableCount: number;
  totalBytes: number;
  durationMs: number;
}
