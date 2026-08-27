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

  const lockedReason = !context.resumeText.trim()
    ? "Add your resume above to generate interview questions."
    : !context.jobDescription.trim()
      ? "Paste the job description above to generate interview questions."
      : !apiKey.trim()
        ? "Connect your API key at the top of the page to generate questions."
        : null;

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
      step="Tool 3"
      title="Interview Preparation"
      subtitle="Questions you'll actually be asked, with model answers built from your resume"
      lockedReason={lockedReason}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          <p className="text-xs text-[#9aa3b0] leading-relaxed max-w-2xl">
            Questions are tailored to the job description, your resume
            {context.appliedPosition ? ` and the ${context.appliedPosition} role` : ""}. Your
            education is read from the resume, and every answer is grounded in what it actually
            says.
          </p>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50"
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
          <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Q&A set ──────────────────────────────────────────────────── */}
        {pairs.length > 0 && (
          <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.07)] pt-5">
            <span className="text-[10px] font-bold text-[#6b7685] tracking-wider uppercase">
              {pairs.length} question{pairs.length === 1 ? "" : "s"} prepared
            </span>

            <ol className="flex flex-col gap-2">
              {pairs.map((pair, i) => {
                const isOpen = openPair === i;
                return (
                  <li
                    key={i}
                    className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] overflow-hidden"
                  >
                    <button
                      onClick={() => setOpenPair(isOpen ? null : i)}
                      className="w-full flex items-start gap-3 text-left p-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                    >
                      <span className="text-[11px] font-mono font-bold text-[#00d4dc] mt-0.5 shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="flex-1 text-sm text-[#eef0f3] font-medium leading-relaxed">
                        {pair.question}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {pair.category && (
                          <span className="hidden md:inline text-[9px] font-mono font-semibold uppercase tracking-wider text-[#6b7685] border border-[rgba(255,255,255,0.07)] rounded-[4px] px-2 py-0.5">
                            {pair.category}
                          </span>
                        )}
                        <ChevronDown
                          className={`w-4 h-4 text-[#6b7685] transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </span>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 pl-11 flex flex-col gap-3">
                        {pair.rationale && (
                          <p className="text-[11px] text-[#6b7685] italic leading-relaxed">
                            Why they ask: {pair.rationale}
                          </p>
                        )}
                        <div className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] rounded-[6px] p-4">
                          <span className="text-[9px] font-bold text-[#6b7685] uppercase tracking-wider">
                            Your answer
                          </span>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-white/80 leading-relaxed">
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
            <div className="border-t border-[rgba(255,255,255,0.07)] pt-5 flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#eef0f3]">Download your prep pack</h3>
                <p className="text-xs text-[#6b7685] mt-1">
                  All {pairs.length} question{pairs.length === 1 ? "" : "s"} with model answers.
                  Pick a format.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => handleExport("pdf")}
                  disabled={exporting !== null}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-[6px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] transition-all active:scale-[0.98] disabled:opacity-50 text-left"
                >
                  {exporting === "pdf" ? (
                    <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
                  ) : (
                    <FileType2 className="w-5 h-5 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {exporting === "pdf" ? "Building…" : "PDF"}
                    </span>
                    <span className="block text-[11px] text-[#6b7685]">Print or share</span>
                  </span>
                </button>

                <button
                  onClick={() => handleExport("docx")}
                  disabled={exporting !== null}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-[6px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] transition-all active:scale-[0.98] disabled:opacity-50 text-left"
                >
                  {exporting === "docx" ? (
                    <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
                  ) : (
                    <FileText className="w-5 h-5 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {exporting === "docx" ? "Building…" : "Word"}
                    </span>
                    <span className="block text-[11px] text-[#6b7685]">Editable .docx</span>
                  </span>
                </button>

                <button
                  onClick={() =>
                    downloadText("interview-prep-qa.txt", qaToPlainText(pairs, exportMeta))
                  }
                  disabled={exporting !== null}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-[6px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128] text-[#9aa3b0] hover:text-[#eef0f3] hover:border-[rgba(255,255,255,0.14)] transition-all active:scale-[0.98] disabled:opacity-50 text-left"
                >
                  <Download className="w-5 h-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">Plain text</span>
                    <span className="block text-[11px] text-[#6b7685]">Paste anywhere</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Interviewer scoring ledger (optional) ────────────────────── */}
        <div className="border-t border-[rgba(255,255,255,0.07)] pt-5">
          <CollapsibleSection
            icon={<ClipboardList className="w-3.5 h-3.5" />}
            title="Interviewer scoring ledger"
            subtitle="Score practice answers on STAR and competency, then compile an executive assessment"
          >
            <div className="flex flex-col gap-5 pt-2">
              <InterviewScoringTable scoreRows={scoreRows} onChange={setScoreRows} />

              {/* Aggregates */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2">
                  <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
                    STAR average
                  </span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-4xl font-extrabold font-mono text-[#eef0f3] tracking-tight">
                      {starAverage.toFixed(2)}
                    </span>
                    <span className="text-[#6b7685] text-xs font-mono">/ 1.00</span>
                  </div>
                  <div className="w-full bg-[#161a1e] h-2 rounded-full overflow-hidden mt-2">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        starAverage >= 0.75
                          ? "bg-green-500"
                          : starAverage < 0.5
                            ? "bg-red-500"
                            : "bg-amber-500"
                      }`}
                      style={{ width: `${starAverage * 100}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#6b7685] mt-1">
                    Competency average {competencyAverage.toFixed(2)} · overall{" "}
                    {overallAverage.toFixed(2)}
                  </p>
                </div>

                <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2">
                  <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
                    Strong answers (STAR ≥ 0.75)
                  </span>
                  <span className="text-4xl font-extrabold font-mono text-green-600 mt-2">
                    {strongAnswers}
                  </span>
                  <p className="text-[11px] text-[#6b7685] mt-1">
                    out of {scoreRows.length} question{scoreRows.length === 1 ? "" : "s"} assessed
                  </p>
                </div>

                <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2">
                  <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
                    Weak answers (STAR &lt; 0.5)
                  </span>
                  <span
                    className={`text-4xl font-extrabold font-mono mt-2 ${
                      weakAnswers > 0 ? "text-red-500" : "text-[#eef0f3]"
                    }`}
                  >
                    {weakAnswers}
                  </span>
                  <p className="text-[11px] text-[#6b7685] mt-1">
                    out of {scoreRows.length} question{scoreRows.length === 1 ? "" : "s"} assessed
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleEvaluate}
                  disabled={isEvaluating || !apiKey.trim()}
                  className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm py-4 uppercase tracking-widest rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50"
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
                    <h3 className="text-sm font-semibold text-[#eef0f3]">
                      Executive candidate assessment
                    </h3>
                    <button
                      onClick={() => downloadText("candidate-assessment-report.txt", evaluationText)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                  </div>
                  <div className="bg-[#1c2128] rounded-[8px] p-5 md:p-6 border border-[rgba(255,255,255,0.07)]">
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
