import React, { useState } from "react";
import { AlertTriangle, Download, Lock, RefreshCw, Sparkles } from "lucide-react";
import type { FeedbackDocument, FeedbackStage, SharedContext, TranscriptSegment } from "../types";
import { RenderMarkdown } from "../lib/renderMarkdown";
import { ExchangeDetail } from "./ExchangeDetail";
import {
  deriveSilentGaps,
  deriveMissedFollowUps,
  deriveJdCoverage,
  filterEvidencedResumeFindings,
} from "../lib/feedbackRollups";
import {
  exportFeedbackToPDF,
  exportFeedbackToDOCX,
  feedbackToPlainText,
  fileStem,
  type FeedbackExportMeta,
} from "../lib/exportFeedback";
import { downloadText } from "../lib/download";

export interface LiveInterviewFeedbackProps {
  sessionId: string;
  segments: TranscriptSegment[];
  context: SharedContext;
  apiKey: string;
  /** The analysed take's own `RecordingSession.startedAt` — threaded through to `FeedbackExportMeta` (LIVE-20) so an exported file names the take it came from, not the moment it was exported. */
  takeStartedAt: number;
  document: FeedbackDocument | null;
  stage: FeedbackStage;
  error: string;
  /** True once Structure has produced exchanges — even before Assess has run
   * or after Assess has failed (D-63: a failed Assess keeps them on screen). */
  hasExchanges: boolean;
  /**
   * D-51 / Claude's Discretion: true once a LIVE-13 speaker correction has
   * landed after `document` was generated, so the stored judgement now rests
   * on an attribution that has since changed. Never regenerates on its own —
   * it only offers the same `onGenerate` action, relabelled, so a
   * regeneration is always something the visitor asked for (it costs them a
   * second pair of paid calls).
   */
  isStale: boolean;
  onGenerate: () => void;
  onRetryJudging: () => void;
  onStartOver: () => void;
  /** D-60: reports a clicked evidence quote's resolved segment upward, straight through to every `ExchangeDetail`. The jump rule (which segment, when it clears) lives in `LiveInterview.tsx`, never here. */
  onJumpToSegment: (seq: number) => void;
  /** D-51: mirrors `canCorrect` — true only once the take is stopped and has a transcript. Passed straight through to every `ExchangeDetail`. */
  canJump: boolean;
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
 * Tool 4's feedback surface (D-58/D-61): renders the assembled
 * `FeedbackDocument` as one scrolling record in D-58's fixed order — silent
 * gaps, missed follow-ups, resume consistency, job-description coverage,
 * strengths / priority improvements, then the exchange-by-exchange detail —
 * with no tab strip and no way to reach the detail without passing the gaps.
 * Mounted by `LiveInterview.tsx`, never inlined into it (D-61).
 *
 * The gaps are the product: `deriveSilentGaps` runs first, before anything
 * else in the six sections, because LIVE-17 says the record *opens with* the
 * unanswered sub-asks. `deriveMissedFollowUps` is the same D-65 detection
 * read from the other direction. `filterEvidencedResumeFindings` runs here
 * (not upstream) because this is the one place in the tree that already
 * holds both the stored resume-consistency findings and the live `segments`
 * D-66's matcher needs — an unverifiable finding is never rendered (D-69).
 *
 * D-70: this is the only surface in Tool 4 that gates on the API key, resume
 * and job description — recording and transcription stay keyless and
 * input-free regardless of what this component renders.
 */
export const LiveInterviewFeedback: React.FC<LiveInterviewFeedbackProps> = ({
  segments,
  context,
  apiKey,
  takeStartedAt,
  document,
  stage,
  error,
  hasExchanges,
  isStale,
  onGenerate,
  onRetryJudging,
  onStartOver,
  onJumpToSegment,
  canJump,
}) => {
  const missing: string[] = [];
  if (!apiKey.trim()) missing.push("your API key");
  if (!context.resumeText.trim()) missing.push("your resume");
  if (!context.jobDescription.trim()) missing.push("the job description");

  const isBusy = stage === "structuring" || stage === "judging";

  /**
   * LIVE-20's three export buttons. `exporting`/`exportError` are this
   * component's own state, separate from the `stage`/`error` props the
   * two-call Structure/Assess pipeline owns — an export failure (a client-
   * side jsPDF/docx error, not a network call) has nothing to do with that
   * pipeline's own retry machinery, so it gets its own small error line
   * rather than borrowing a prop this component has no setter for.
   */
  const [exporting, setExporting] = useState<null | "pdf" | "docx" | "txt">(null);
  const [exportError, setExportError] = useState("");

  const handleExport = async (format: "pdf" | "docx" | "txt") => {
    if (!document) return;
    const meta: FeedbackExportMeta = {
      appliedPosition: context.appliedPosition,
      startedAt: takeStartedAt,
      generatedAt: document.generatedAt,
    };
    // D-69: an export must never carry a resume-consistency finding the
    // screen itself would not show — the same filterEvidencedResumeFindings
    // gate Section 3 below applies at render time, applied here before any
    // exporter ever sees the document.
    const docForExport: FeedbackDocument = {
      ...document,
      resumeConsistency: filterEvidencedResumeFindings(document.resumeConsistency, segments),
    };

    setExporting(format);
    setExportError("");
    try {
      if (format === "pdf") {
        await exportFeedbackToPDF(docForExport, meta);
      } else if (format === "docx") {
        await exportFeedbackToDOCX(docForExport, meta);
      } else {
        downloadText(`${fileStem(meta)}-feedback.txt`, feedbackToPlainText(docForExport, meta));
      }
    } catch (err: any) {
      setExportError(
        err?.message || `Failed to export the feedback document as ${format.toUpperCase()}.`,
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="rounded-control border border-rule bg-sunken p-4 flex flex-col gap-4">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">Feedback document</h3>
        <p className="text-[15px] text-ink-muted mt-1 leading-relaxed measure">
          Judges what was said, not how it was said — never accent, fluency, pace, fillers, or
          confidence.
        </p>
      </div>

      {missing.length > 0 ? (
        <div className="p-3 bg-ink/[0.04] border border-rule rounded-control text-[15px] text-ink-soft flex items-start gap-2">
          <Lock className="w-4 h-4 shrink-0 mt-0.5 text-ink-muted" />
          <span>
            Add {missing.join(" and ")} above to generate a feedback document. Recording, mic setup,
            consent and transcription all work without them.
          </span>
        </div>
      ) : (
        <>
          {!hasExchanges && (
            <button
              onClick={onGenerate}
              disabled={isBusy || segments.length === 0}
              className="self-start inline-flex items-center justify-center gap-2 rounded-control bg-solid px-5 py-2.5 text-[15px] font-medium text-solid-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
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
            <div className="p-3 bg-mark/10 text-mark border border-mark/15 rounded-control text-[15px] flex flex-col gap-2 font-medium">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </span>
              {hasExchanges && (
                <>
                  <span className="text-ink-soft font-normal">
                    The extracted questions are still here — nothing needs to be re-read.
                  </span>
                  <span className="flex gap-2">
                    <button
                      onClick={onRetryJudging}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent text-[15px] font-semibold transition-all disabled:opacity-50"
                    >
                      {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                      Try judging again
                    </button>
                    <button
                      onClick={onStartOver}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-rule bg-surface text-ink-soft hover:text-ink text-[15px] font-semibold transition-all disabled:opacity-50"
                    >
                      Start over
                    </button>
                  </span>
                </>
              )}
            </div>
          )}

          {document && isStale && (
            <div className="p-3 bg-warn/10 text-warn border border-warn/15 rounded-control text-[15px] flex flex-col gap-2 font-medium">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  A speaker label changed after this was generated — it may no longer match the
                  transcript above.
                </span>
              </span>
              <span>
                <button
                  onClick={onGenerate}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent text-[15px] font-semibold transition-all disabled:opacity-50"
                >
                  {isBusy ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Regenerate feedback
                </button>
              </span>
            </div>
          )}

          {document && (
            <div className="flex flex-col gap-6 border-t border-rule pt-4">
              {/* LIVE-20: export row — beneath the title, above every section
                  below (including Section 1's silent gaps), so a reader who
                  came only to export is not made to scroll past the whole
                  record, and D-58's gaps still stand as the first *content*
                  a reader who scrolls actually reaches. Rendered even for a
                  zero-exchange document — `exportFeedback.ts`'s own
                  zero-exchange branch produces a real, honest file rather
                  than throwing. */}
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleExport("pdf")}
                    disabled={exporting !== null}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-control bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent transition-all disabled:opacity-50 text-[15px] font-semibold tracking-wide"
                  >
                    {exporting === "pdf" ? (
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 shrink-0" />
                    )}
                    <span>{exporting === "pdf" ? "Preparing…" : "PDF"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("docx")}
                    disabled={exporting !== null}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-control bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent transition-all disabled:opacity-50 text-[15px] font-semibold tracking-wide"
                  >
                    {exporting === "docx" ? (
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 shrink-0" />
                    )}
                    <span>{exporting === "docx" ? "Preparing…" : "Word"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("txt")}
                    disabled={exporting !== null}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-control border border-rule bg-surface text-ink-soft hover:text-ink transition-all disabled:opacity-50 text-[15px] font-semibold tracking-wide"
                  >
                    {exporting === "txt" ? (
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 shrink-0" />
                    )}
                    <span>{exporting === "txt" ? "Preparing…" : "Plain text"}</span>
                  </button>
                </div>
                {exportError && (
                  <p className="text-[15px] text-mark" role="alert">
                    {exportError}
                  </p>
                )}
              </div>

              {document.exchanges.length === 0 ? (
                <p className="text-[15px] text-ink-soft">
                  No substantive questions were found in this take.
                </p>
              ) : (
                <>
                  {/* Section 1 (D-58, first — LIVE-17's headline): silent gaps. */}
                  <section className="flex flex-col gap-2.5">
                    <h4 className="text-[15px] font-semibold text-ink">Silent gaps</h4>
                    <p className="text-[15px] text-ink-muted leading-relaxed measure">
                      Things the interviewer asked outright that the answer did not cover.
                    </p>
                    <SubAskRollupList
                      items={deriveSilentGaps(document)}
                      emptyText="Every sub-ask the interviewer asked was addressed."
                    />
                  </section>

                  {/* Section 2 (D-58, D-65): missed follow-ups — feedback for the
                      interviewer, never framed as a question the candidate dodged. */}
                  <section className="flex flex-col gap-2.5">
                    <h4 className="text-[15px] font-semibold text-ink">Missed follow-ups</h4>
                    <p className="text-[15px] text-ink-muted leading-relaxed measure">
                      What the job description implies the interviewer should have probed and did
                      not.
                    </p>
                    <SubAskRollupList
                      items={deriveMissedFollowUps(document)}
                      emptyText="No follow-up implied by the job description was missed."
                    />
                  </section>

                  {/* Section 3 (D-58, D-69): resume consistency. Every finding here has
                      already passed filterEvidencedResumeFindings — a finding whose
                      spoken side does not match the stored transcript verbatim never
                      reaches this render. */}
                  <section className="flex flex-col gap-2.5">
                    <h4 className="text-[15px] font-semibold text-ink">Resume consistency</h4>
                    <p className="text-[15px] text-ink-muted leading-relaxed measure">
                      To reconcile, not proven — the transcript may have misheard a word, or the
                      resume may be out of date.
                    </p>
                    {(() => {
                      const evidencedFindings = filterEvidencedResumeFindings(
                        document.resumeConsistency,
                        segments,
                      );
                      return evidencedFindings.length === 0 ? (
                        <p className="text-[15px] text-ink-soft">
                          Nothing said contradicted the resume.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-2.5">
                          {evidencedFindings.map((finding, i) => (
                            <li
                              key={i}
                              className="flex flex-col gap-2 bg-surface border border-rule rounded-control p-3"
                            >
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div className="flex flex-col gap-0.5">
                                  <span className="label">Said</span>
                                  <span className="text-[15px] text-white/80 italic leading-relaxed measure">
                                    "{finding.spokenQuote}"
                                  </span>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="label">Resume says</span>
                                  <span className="text-[15px] text-white/80 italic leading-relaxed measure">
                                    "{finding.resumeLine}"
                                  </span>
                                </div>
                              </div>
                              {finding.note && (
                                <span className="text-[15px] text-ink-soft leading-relaxed measure">
                                  {finding.note}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </section>

                  {/* Section 4 (D-58, LIVE-19): JD coverage. */}
                  <section className="flex flex-col gap-2.5">
                    <h4 className="text-[15px] font-semibold text-ink">JD coverage</h4>
                    <p className="text-[15px] text-ink-muted leading-relaxed measure">
                      Job-description requirements nothing in the interview evidenced.
                    </p>
                    {(() => {
                      const uncoveredRequirements = deriveJdCoverage(document);
                      return uncoveredRequirements.length === 0 ? (
                        <p className="text-[15px] text-ink-soft">
                          Every requirement drawn from the job description was evidenced.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {uncoveredRequirements.map((item, i) => (
                            <li
                              key={i}
                              className="text-[15px] text-white/80 leading-relaxed pl-4 relative before:content-['—'] before:absolute before:left-0 before:text-ink-muted measure"
                            >
                              {item.requirement}
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </section>

                  {/* Section 5 (D-58, D-68): strengths and priority improvements. The
                      D-68 withheld-remark disclosure sits here, where the reader will
                      actually see the prose it refers to. */}
                  <section className="flex flex-col gap-3">
                    {document.withheldRemarkCount > 0 && (
                      <p className="text-[13px] text-warn leading-relaxed">
                        {document.withheldRemarkCount} remark
                        {document.withheldRemarkCount === 1 ? "" : "s"} about delivery{" "}
                        {document.withheldRemarkCount === 1 ? "was" : "were"} withheld from this
                        record — this tool judges content only.
                      </p>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <h4 className="text-[15px] font-semibold text-ink">Strengths</h4>
                      <RenderMarkdown text={document.strengths} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <h4 className="text-[15px] font-semibold text-ink">Priority improvements</h4>
                      <RenderMarkdown text={document.priorityImprovements} />
                    </div>
                  </section>

                  {/* Section 6 (D-58, last): exchange-by-exchange detail. Plan 06-05's
                      body swap — the heading, ordering position, and props boundary are
                      unchanged from 06-04; only the per-exchange body is now
                      `ExchangeDetail` (D-59's collapsed card), one per exchange, in the
                      order the document already carries them (no re-sort here — plan
                      06-01 sorted at assembly time). */}
                  <section className="flex flex-col gap-3">
                    <h4 className="text-[15px] font-semibold text-ink">
                      Exchange-by-exchange detail
                    </h4>
                    {document.exchanges.map((exchange) => (
                      <ExchangeDetail
                        key={exchange.exchangeIndex}
                        exchange={exchange}
                        onJumpToSegment={onJumpToSegment}
                        canJump={canJump}
                      />
                    ))}
                  </section>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * The shared row renderer for D-58's Section 1 (silent gaps) and Section 2
 * (missed follow-ups) — `SilentGap` and `MissedFollowUp` from
 * `feedbackRollups.ts` carry the identical shape and render identically;
 * only the section-level framing text and the `emptyText` sentence differ by
 * call site. Coverage is distinguished by glyph plus text (D-59), never by
 * colour alone.
 */
interface SubAskRollupItem {
  exchangeIndex: number;
  questionText: string;
  subAskText: string;
  coverage: string;
}

const SubAskRollupList: React.FC<{ items: SubAskRollupItem[]; emptyText: string }> = ({
  items,
  emptyText,
}) => {
  if (items.length === 0) {
    return <p className="text-[15px] text-ink-soft">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex flex-col gap-1 bg-surface border border-rule rounded-control p-3"
        >
          <span className="flex items-center gap-2 text-[15px]">
            <span className="text-accent font-mono shrink-0">
              {COVERAGE_GLYPH[item.coverage] ?? "○"}
            </span>
            <span className="font-semibold text-ink">
              {COVERAGE_LABEL[item.coverage] ?? item.coverage}
            </span>
          </span>
          <span className="text-[13px] text-ink-muted italic leading-relaxed measure">
            {item.questionText}
          </span>
          <span className="text-[15px] text-white/80 leading-relaxed measure">
            {item.subAskText}
          </span>
        </li>
      ))}
    </ul>
  );
};
