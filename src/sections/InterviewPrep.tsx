import React, { useState } from "react";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Download,
  MessagesSquare,
  FileText,
  FileType2,
  ChevronDown,
  ClipboardList,
  SlidersHorizontal,
} from "lucide-react";
import { ToolSection } from "../components/ToolSection";
import { toolReadiness } from "../lib/readiness";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { FileUploader } from "../components/FileUploader";
import { InterviewScoringTable } from "../components/InterviewScoringTable";
import { downloadText } from "../lib/download";
import { exportQAtoPDF, exportQAtoDOCX, qaToPlainText } from "../lib/exportQA";
import { RenderMarkdown } from "../lib/renderMarkdown";
import { QAPair, ScoreRow, SharedContext } from "../types";

interface InterviewPrepProps {
  context: SharedContext;
  apiKey: string;
}

const blankRow = (question: string): ScoreRow => ({
  questionDescription: question,
  s: 0.5,
  tE: 0.5,
  a: 0.5,
  rT: 0.5,
  starRating: 0.5,
  cS: 0.5,
  aE: 0.5,
  rA: 0.5,
  competencyRating: 0.5,
});

export const InterviewPrep: React.FC<InterviewPrepProps> = ({ context, apiKey }) => {
  // ── Q&A generation (candidate-facing) ──────────────────────────────────
  const [pairs, setPairs] = useState<QAPair[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [openPair, setOpenPair] = useState<number | null>(0);
  const [error, setError] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPromptFileName, setCustomPromptFileName] = useState("");
  const [exporting, setExporting] = useState<null | "pdf" | "docx">(null);

  // ── Scoring ledger (interviewer-facing) ────────────────────────────────
  const [scoreRows, setScoreRows] = useState<ScoreRow[]>([blankRow("Interview question #1")]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationText, setEvaluationText] = useState("");
  const [customEvalPrompt, setCustomEvalPrompt] = useState("");
  const [evalPromptFileName, setEvalPromptFileName] = useState("");

  const lockedReason = toolReadiness(context, apiKey).prep;

  const exportMeta = { appliedPosition: context.appliedPosition };

  const handleGenerate = async () => {
    setError("");
    setIsGenerating(true);
    setPairs([]);
    setEvaluationText("");

    try {
      const response = await fetch("/api/interview/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: context.jobDescription,
          resumeText: context.resumeText,
          appliedPosition: context.appliedPosition,
          customPrompt,
          apiKey,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Question generation failed.");

      const generated: QAPair[] = data.pairs;
      setPairs(generated);
      setOpenPair(0);
      // Seed the scoring ledger from the real question list — no prose parsing.
      setScoreRows(generated.map((p) => blankRow(p.question)));
    } catch (err: any) {
      setError(err?.message || "Could not reach the model.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Both exporters dynamically import their (heavy) library, so both are async
  // and both can fail on a slow network — hence the shared handler.
  const handleExport = async (format: "pdf" | "docx") => {
    setError("");
    setExporting(format);
    try {
      if (format === "pdf") {
        await exportQAtoPDF(pairs, exportMeta);
      } else {
        await exportQAtoDOCX(pairs, exportMeta);
      }
    } catch (err: any) {
      setError(err?.message || `${format.toUpperCase()} export failed.`);
    } finally {
      setExporting(null);
    }
  };

  // ── Ledger metrics ─────────────────────────────────────────────────────
  // Each aggregate is named for exactly what it measures — the mean of the STAR
  // column, the mean of the competency column, and the mean of both together.
  const mean = (values: number[]) =>
    values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0;

  const starAverage = mean(scoreRows.map((r) => r.starRating));
  const competencyAverage = mean(scoreRows.map((r) => r.competencyRating));
  const overallAverage = mean([
    ...scoreRows.map((r) => r.starRating),
    ...scoreRows.map((r) => r.competencyRating),
  ]);
  const strongAnswers = scoreRows.filter((r) => r.starRating >= 0.75).length;
  const weakAnswers = scoreRows.filter((r) => r.starRating < 0.5).length;

  const handleEvaluate = async () => {
    setError("");
    setIsEvaluating(true);
    setEvaluationText("");

    const metricTable = [
      { metric: "STAR average (mean of STAR column)", value: starAverage },
      { metric: "Competency average (mean of competency column)", value: competencyAverage },
      { metric: "Overall mean (STAR and competency combined)", value: overallAverage },
      { metric: "Answers scoring STAR >= 0.75", value: strongAnswers },
      { metric: "Answers scoring STAR < 0.5", value: weakAnswers },
      { metric: "Questions assessed", value: scoreRows.length },
    ];

    try {
      const response = await fetch("/api/interview/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scoringTable: scoreRows,
          metricTable,
          questionSimulationReport: pairs.length ? qaToPlainText(pairs, exportMeta) : "",
          customPrompt: customEvalPrompt,
          apiKey,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Evaluation failed.");

      setEvaluationText(data.report);
    } catch (err: any) {
      setError(err?.message || "Could not reach the model.");
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <ToolSection
      id="tool-interview-prep"
      step="04"
      phase="Preparation"
      title="Interview Preparation"
      subtitle="The questions you'll be asked, with answers from your resume."
      lockedReason={lockedReason}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-ink-soft leading-relaxed measure">
            Tailored to the job description and your resume
            {context.appliedPosition ? `, for the ${context.appliedPosition} role` : ""}. Every
            answer is grounded in what your resume actually says.
          </p>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="self-start inline-flex items-center justify-center gap-2 rounded-control bg-solid px-5 py-2.5 text-[15px] font-medium text-solid-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Preparing your set…</span>
              </>
            ) : (
              <>
                <MessagesSquare className="w-4 h-4" />
                <span>Generate questions &amp; answers</span>
              </>
            )}
          </button>

          <CollapsibleSection
            icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
            title="Override the coaching prompt"
            subtitle="Optional — replace the built-in coaching instructions with your own"
            badge={customPromptFileName || null}
          >
            <FileUploader
              id="interview_custom_prompt"
              label="Custom coaching prompt"
              placeholderText="Drop a custom prompt file"
              onTextLoaded={(text, filename) => {
                setCustomPrompt(text);
                setCustomPromptFileName(filename);
              }}
            />
          </CollapsibleSection>
        </div>

        {error && (
          <div className="p-3 bg-mark/10 text-mark border border-mark/15 rounded-control text-[15px] flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Q&A set ──────────────────────────────────────────────────── */}
        {pairs.length > 0 && (
          <div className="flex flex-col gap-4 border-t border-rule pt-5">
            <span className="text-xs font-bold text-ink-muted tracking-wider">
              {pairs.length} question{pairs.length === 1 ? "" : "s"} prepared
            </span>

            <ol className="flex flex-col gap-2">
              {pairs.map((pair, i) => {
                const isOpen = openPair === i;
                return (
                  <li
                    key={i}
                    className="bg-sunken border border-rule rounded-control overflow-hidden"
                  >
                    <button
                      onClick={() => setOpenPair(isOpen ? null : i)}
                      className="w-full flex items-start gap-3 text-left p-4 hover:bg-ink/[0.03] transition-colors"
                    >
                      <span className="text-[13px] font-mono font-bold text-accent mt-0.5 shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="flex-1 text-[15px] text-ink font-medium leading-relaxed measure">
                        {pair.question}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {pair.category && (
                          <span className="hidden md:inline text-xs font-mono font-semibold tracking-wider text-ink-muted border border-rule rounded-[3px] px-2 py-0.5">
                            {pair.category}
                          </span>
                        )}
                        <ChevronDown
                          className={`w-4 h-4 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </span>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 pl-11 flex flex-col gap-3">
                        {pair.rationale && (
                          <p className="text-[13px] text-ink-muted italic leading-relaxed measure">
                            Why they ask: {pair.rationale}
                          </p>
                        )}
                        <div className="bg-surface border border-rule rounded-control p-4">
                          <span className="text-xs font-bold text-ink-muted tracking-wider">
                            Your answer
                          </span>
                          <p className="mt-2 whitespace-pre-wrap text-[15px] text-white/80 leading-relaxed measure">
                            {pair.answer}
                          </p>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            {/* Export lives below the set: it is the last thing you want once
                you've read the questions, and it was previously a row of small
                chips above the fold that read as labels rather than actions. */}
            <div className="border-t border-rule pt-5 flex flex-col gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-ink">Download your prep pack</h3>
                <p className="text-[15px] text-ink-muted mt-1">
                  All {pairs.length} question{pairs.length === 1 ? "" : "s"} with model answers.
                  Pick a format.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => handleExport("pdf")}
                  disabled={exporting !== null}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-control bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent transition-all disabled:opacity-50 text-left"
                >
                  {exporting === "pdf" ? (
                    <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
                  ) : (
                    <FileType2 className="w-5 h-5 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">
                      {exporting === "pdf" ? "Building…" : "PDF"}
                    </span>
                    <span className="block text-[13px] text-ink-muted">Print or share</span>
                  </span>
                </button>

                <button
                  onClick={() => handleExport("docx")}
                  disabled={exporting !== null}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-control bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent transition-all disabled:opacity-50 text-left"
                >
                  {exporting === "docx" ? (
                    <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
                  ) : (
                    <FileText className="w-5 h-5 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">
                      {exporting === "docx" ? "Building…" : "Word"}
                    </span>
                    <span className="block text-[13px] text-ink-muted">Editable .docx</span>
                  </span>
                </button>

                <button
                  onClick={() =>
                    downloadText("interview-prep-qa.txt", qaToPlainText(pairs, exportMeta))
                  }
                  disabled={exporting !== null}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-control border border-rule bg-sunken text-ink-soft hover:text-ink hover:border-rule transition-all disabled:opacity-50 text-left"
                >
                  <Download className="w-5 h-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">Plain text</span>
                    <span className="block text-[13px] text-ink-muted">Paste anywhere</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Interviewer scoring ledger (optional) ────────────────────── */}
        <div className="border-t border-rule pt-5">
          <CollapsibleSection
            icon={<ClipboardList className="w-3.5 h-3.5" />}
            title="Interviewer scoring ledger"
            subtitle="Score practice answers on STAR and competency, then compile an executive assessment"
          >
            <div className="flex flex-col gap-5 pt-2">
              <InterviewScoringTable scoreRows={scoreRows} onChange={setScoreRows} />

              {/* Aggregates */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div className="bg-sunken border border-rule p-5 rounded-control flex flex-col items-center justify-center gap-2">
                  <span className="text-xs font-bold text-ink-muted tracking-wider">
                    STAR average
                  </span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-4xl font-extrabold font-mono text-ink tracking-tight">
                      {starAverage.toFixed(2)}
                    </span>
                    <span className="text-ink-muted text-[15px] font-mono">/ 1.00</span>
                  </div>
                  <div className="w-full bg-surface h-2 rounded-full overflow-hidden mt-2">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        starAverage >= 0.75
                          ? "bg-green-500"
                          : starAverage < 0.5
                            ? "bg-mark"
                            : "bg-warn"
                      }`}
                      style={{ width: `${starAverage * 100}%` }}
                    />
                  </div>
                  <p className="text-[13px] text-ink-muted mt-1">
                    Competency average {competencyAverage.toFixed(2)} · overall{" "}
                    {overallAverage.toFixed(2)}
                  </p>
                </div>

                <div className="bg-sunken border border-rule p-5 rounded-control flex flex-col items-center justify-center gap-2">
                  <span className="text-xs font-bold text-ink-muted tracking-wider">
                    Strong answers (STAR ≥ 0.75)
                  </span>
                  <span className="text-4xl font-extrabold font-mono text-green-600 mt-2">
                    {strongAnswers}
                  </span>
                  <p className="text-[13px] text-ink-muted mt-1">
                    out of {scoreRows.length} question{scoreRows.length === 1 ? "" : "s"} assessed
                  </p>
                </div>

                <div className="bg-sunken border border-rule p-5 rounded-control flex flex-col items-center justify-center gap-2">
                  <span className="text-xs font-bold text-ink-muted tracking-wider">
                    Weak answers (STAR &lt; 0.5)
                  </span>
                  <span
                    className={`text-4xl font-extrabold font-mono mt-2 ${
                      weakAnswers > 0 ? "text-mark" : "text-ink"
                    }`}
                  >
                    {weakAnswers}
                  </span>
                  <p className="text-[13px] text-ink-muted mt-1">
                    out of {scoreRows.length} question{scoreRows.length === 1 ? "" : "s"} assessed
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleEvaluate}
                  disabled={isEvaluating || !apiKey.trim()}
                  className="self-start inline-flex items-center justify-center gap-2 rounded-control bg-solid px-5 py-2.5 text-[15px] font-medium text-solid-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isEvaluating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Compiling analytics…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Compile executive assessment</span>
                    </>
                  )}
                </button>

                <CollapsibleSection
                  icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
                  title="Override the assessment prompt"
                  subtitle="Optional — replace the built-in assessor instructions with your own"
                  badge={evalPromptFileName || null}
                >
                  <FileUploader
                    id="eval_custom_prompt"
                    label="Custom assessor prompt"
                    placeholderText="Drop a custom assessor prompt"
                    onTextLoaded={(text, filename) => {
                      setCustomEvalPrompt(text);
                      setEvalPromptFileName(filename);
                    }}
                  />
                </CollapsibleSection>
              </div>

              {evaluationText && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-[15px] font-semibold text-ink">
                      Executive candidate assessment
                    </h3>
                    <button
                      onClick={() =>
                        downloadText("candidate-assessment-report.txt", evaluationText)
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent text-[15px] font-semibold transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                  </div>
                  <div className="bg-sunken rounded-control p-5 md:p-6 border border-rule">
                    <RenderMarkdown text={evaluationText} />
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </ToolSection>
  );
};
