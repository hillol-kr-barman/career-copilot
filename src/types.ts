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
