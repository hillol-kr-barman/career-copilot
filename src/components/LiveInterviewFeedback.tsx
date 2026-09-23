import React from "react";
import { AlertTriangle, Lock, RefreshCw, Sparkles } from "lucide-react";
import type { FeedbackDocument, FeedbackStage, SharedContext, TranscriptSegment } from "../types";
import { RenderMarkdown } from "../lib/renderMarkdown";

export interface LiveInterviewFeedbackProps {
  sessionId: string;
  segments: TranscriptSegment[];
  context: SharedContext;
  apiKey: string;
  document: FeedbackDocument | null;
  stage: FeedbackStage;
  error: string;
  /** True once Structure has produced exchanges — even before Assess has run
   * or after Assess has failed (D-63: a failed Assess keeps them on screen). */
  hasExchanges: boolean;
  onGenerate: () => void;
  onRetryJudging: () => void;
  onStartOver: () => void;
}

const COVERAGE_LABEL: Record<string, string> = {
  ADDRESSED: "Addressed",
  PARTIAL: "Partial",
  NOT_ADDRESSED: "Not addressed",
  DEFLECTED: "Deflected",
};

const COVERAGE_GLYPH: Record<string, string> = {
  ADDRESSED: "●",
  PARTIAL: "◐",
  NOT_ADDRESSED: "○",
  DEFLECTED: "◒",
};

const STAGE_COPY: Record<FeedbackStage, string> = {
  idle: "",
  structuring: "Reading the transcript and pulling out the substantive questions…",
  judging: "Judging each answer against the evidence…",
  done: "",
};

/**
 * Tool 4's feedback document surface (D-58/D-61) — the tracer slice only
 * renders a flat list of judged exchanges; the ordered rollups (silent gaps,
 * missed follow-ups, resume consistency, JD coverage) land in later plans.
 * Mounted by `LiveInterview.tsx`, never inlined into it (D-61).
 *
 * D-70: this is the only surface in Tool 4 that gates on the API key, resume
 * and job description — recording and transcription stay keyless and
 * input-free regardless of what this component renders.
 */
export const LiveInterviewFeedback: React.FC<LiveInterviewFeedbackProps> = ({
  segments,
  context,
  apiKey,
  document,
  stage,
  error,
  hasExchanges,
  onGenerate,
  onRetryJudging,
  onStartOver,
}) => {
  const missing: string[] = [];
  if (!apiKey.trim()) missing.push("your API key");
  if (!context.resumeText.trim()) missing.push("your resume");
  if (!context.jobDescription.trim()) missing.push("the job description");

  const isBusy = stage === "structuring" || stage === "judging";

  return (
    <div className="rounded-[8px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128] p-4 flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-[#eef0f3]">Feedback document</h3>
        <p className="text-xs text-[#6b7685] mt-1 leading-relaxed">
          This judges what was said and how completely it answered the question — never accent,
          fluency, pace, filler words, or confidence.
        </p>
      </div>

      {missing.length > 0 ? (
        <div className="p-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)] rounded-[6px] text-xs text-[#9aa3b0] flex items-start gap-2">
          <Lock className="w-4 h-4 shrink-0 mt-0.5 text-[#6b7685]" />
          <span>
            Add {missing.join(" and ")} above to generate a feedback document. Recording, mic
            setup, consent and transcription all work without them.
          </span>
        </div>
      ) : (
        <>
          {!hasExchanges && (
            <button
              onClick={onGenerate}
              disabled={isBusy || segments.length === 0}
              className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50"
            >
              {isBusy ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{STAGE_COPY[stage] || "Generating feedback…"}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate feedback</span>
                </>
              )}
            </button>
          )}

          {error && (
            <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex flex-col gap-2 font-medium">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </span>
              {hasExchanges && (
                <>
                  <span className="text-[#9aa3b0] font-normal">
                    The extracted questions are still here — nothing needs to be re-read.
                  </span>
                  <span className="flex gap-2">
                    <button
                      onClick={onRetryJudging}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                      Try judging again
                    </button>
                    <button
                      onClick={onStartOver}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border border-[rgba(255,255,255,0.07)] bg-[#161a1e] text-[#9aa3b0] hover:text-[#eef0f3] text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                    >
                      Start over
                    </button>
                  </span>
                </>
              )}
            </div>
          )}

          {document && (
            <div className="flex flex-col gap-3 border-t border-[rgba(255,255,255,0.07)] pt-4">
              {document.exchanges.length === 0 ? (
                <p className="text-sm text-[#9aa3b0]">
                  No substantive questions were found in this take.
                </p>
              ) : (
                document.exchanges
                  .slice()
                  .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0) || a.exchangeIndex - b.exchangeIndex)
                  .map((exchange) => (
                    <div
                      key={exchange.exchangeIndex}
                      className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] rounded-[6px] p-4 flex flex-col gap-3"
                    >
                      <p className="text-sm font-semibold text-[#eef0f3] leading-relaxed">
                        {exchange.questionText}
                      </p>
                      {exchange.questionIntent && (
                        <p className="text-[11px] text-[#6b7685] italic leading-relaxed">
                          {exchange.questionIntent}
                        </p>
                      )}

                      <ul className="flex flex-col gap-2.5">
                        {exchange.subAsks.map((subAsk, i) => (
                          <li
                            key={i}
                            className="flex flex-col gap-1 border-t border-[rgba(255,255,255,0.05)] pt-2.5 first:border-t-0 first:pt-0"
                          >
                            <span className="flex items-start gap-2 text-xs">
                              <span className="text-[#00d4dc] font-mono shrink-0">
                                {COVERAGE_GLYPH[subAsk.coverage] ?? "○"}
                              </span>
                              <span className="font-semibold text-[#eef0f3]">
                                {COVERAGE_LABEL[subAsk.coverage] ?? subAsk.coverage}
                              </span>
                              {subAsk.source === "implied_by_jd" && (
                                <span className="text-[9px] font-mono font-semibold uppercase tracking-wider text-[#6b7685] border border-[rgba(255,255,255,0.07)] rounded-[4px] px-1.5 py-0.5">
                                  Implied by JD
                                </span>
                              )}
                            </span>
                            <span className="text-sm text-white/80 leading-relaxed pl-5">
                              {subAsk.text}
                            </span>
                            {subAsk.evidenceQuote && (
                              <span className="text-xs text-[#9aa3b0] italic leading-relaxed pl-5">
                                "{subAsk.evidenceQuote}"
                              </span>
                            )}
                            {subAsk.quoteUnverified && (
                              <span className="text-[11px] text-amber-500 pl-5">
                                No quotable evidence was found for this in the transcript.
                              </span>
                            )}
                            {subAsk.assessment && (
                              <div className="pl-5 text-xs text-[#9aa3b0] leading-relaxed">
                                <RenderMarkdown text={subAsk.assessment} />
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
