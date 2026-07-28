import React, { useState } from "react";
import {
  Sparkles,
  AlertTriangle,
  Download,
  RefreshCw,
  Play,
} from "lucide-react";
import { StackingContainer, StackingCard } from "../components/StackingContainer";
import { FileUploader } from "../components/FileUploader";
import { InterviewScoringTable } from "../components/InterviewScoringTable";
import { ScoreRow } from "../types";

interface InterviewPrepPageProps {
  resumeText: string;
  selectedModel: string;
  userApiKey: string;
}

// Browser download helper for text content
const handleDownload = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export default function InterviewPrepPage({ resumeText, selectedModel, userApiKey }: InterviewPrepPageProps) {
  // Inputs - Interview Mode
  const [interviewJd, setInterviewJd] = useState<string>(
    `Role: Senior Software Engineer (Frontend)`
  );
  const [interviewResumeText, setInterviewResumeText] = useState<string>("");
  const [interviewResumeFileName, setInterviewResumeFileName] = useState<string>("");
  const [customInterviewPrompt, setCustomInterviewPrompt] = useState<string>("");
  const [interviewPromptFileName, setInterviewPromptFileName] = useState<string>("");

  // Outputs - Interview Mode
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState<boolean>(false);
  const [questionsReport, setQuestionsReport] = useState<string>("");
  const [interviewError, setInterviewError] = useState<string>("");

  // Intermediate - Assessment Evaluation scoring table
  const [scoreRows, setScoreRows] = useState<ScoreRow[]>([
    {
      questionDescription: "Can you detail a complex architectural scenario where React state or ref changes led to infinite loops, and how you tracked/stabilized dependencies?",
      s: 0.8,
      tE: 0.7,
      a: 0.9,
      rT: 0.8,
      starRating: 0.8,
      cS: 0.8,
      aE: 0.9,
      rA: 0.8,
      competencyRating: 0.83,
    },
    {
      questionDescription: "Demonstrate your experience preparing custom bundle setups with esbuild or Vite CJS packaging for optimized server-side telemetry runtimes.",
      s: 0.6,
      tE: 0.6,
      a: 0.5,
      rT: 0.7,
      starRating: 0.6,
      cS: 0.7,
      aE: 0.6,
      rA: 0.7,
      competencyRating: 0.67,
    },
    {
      questionDescription: "Describe your capability auditing secure OAuth integrations within constrained browser sandbox frames.",
      s: 0.5,
      tE: 0.4,
      a: 0.5,
      rT: 0.5,
      starRating: 0.48,
      cS: 0.6,
      aE: 0.5,
      rA: 0.6,
      competencyRating: 0.57,
    }
  ]);

  // Evaluated HR report State
  const [isEvaluatingInterview, setIsEvaluatingInterview] = useState<boolean>(false);
  const [evaluationReportText, setEvaluationReportText] = useState<string>("");
  const [customEvalPrompt, setCustomEvalPrompt] = useState<string>("");
  const [evalPromptFileName, setEvalPromptFileName] = useState<string>("");

  // Compute stats metrics dynamically based on scorecard rows
  const getCalculatedMetrics = () => {
    const starRatings = scoreRows.map((r) => r.starRating);
    const competencyRatings = scoreRows.map((r) => r.competencyRating);
    const allAverages = [...starRatings, ...competencyRatings];

    const avgScore = allAverages.length
      ? Number((allAverages.reduce((sum, v) => sum + v, 0) / allAverages.length).toFixed(2))
      : 0.0;

    const strongCount = allAverages.filter((v) => v >= 0.75).length;
    const weakCount = allAverages.filter((v) => v < 0.5).length;

    return {
      averageScore: avgScore,
      strongCount,
      weakCount,
    };
  };

  const currentMetrics = getCalculatedMetrics();

  // Action: Generate Tailored Interview Questions
  const handleGenerateQuestions = async () => {
    setInterviewError("");
    const jdToUse = interviewJd.trim();
    const resumeToUse = interviewResumeText.trim() || resumeText.trim();

    if (!jdToUse) {
      setInterviewError("Please provide a representative Job Description.");
      return;
    }
    if (!resumeToUse) {
      setInterviewError("Please upload a resume or audit text to extract customized questions.");
      return;
    }

    setIsGeneratingQuestions(true);
    setQuestionsReport("");

    try {
      const response = await fetch("/api/interview/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: jdToUse,
          resumeText: resumeToUse,
          customPrompt: customInterviewPrompt,
          apiKey: userApiKey,
          model: selectedModel,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Simulation generator failed.");
      }

      setQuestionsReport(data.report);

      // Instantly inject questions representation as descriptions into the scoring scorecard table
      // to synchronize the workflow dynamically!
      const questionsList = data.report
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => /^\d+\.\s+/.test(line) || line.startsWith("Q:") || line.includes("?"))
        .slice(0, 5);

      if (questionsList.length > 0) {
        const nextScoreRows = questionsList.map((q: string, i: number) => ({
          questionDescription: q.replace(/^\d+\.\s*/, "").replace(/^Q:\s*/, ""),
          s: 0.5,
          tE: 0.5,
          a: 0.5,
          rT: 0.5,
          starRating: 0.5,
          cS: 0.5,
          aE: 0.5,
          rA: 0.5,
          competencyRating: 0.5,
        }));
        setScoreRows(nextScoreRows);
      }
    } catch (err: any) {
      setInterviewError(err?.message || "Connection timeout or model quota error.");
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  // Action: Compute final coaching evaluation narrative reports
  const handleEvaluateInterview = async () => {
    setInterviewError("");
    setIsEvaluatingInterview(true);
    setEvaluationReportText("");

    const metricTable = [
      { metric: "Overall STAR Average", value: currentMetrics.averageScore },
      { metric: "High Performance Skills (>= 0.75)", value: currentMetrics.strongCount },
      { metric: "Areas of Concern (< 0.5)", value: currentMetrics.weakCount },
    ];

    try {
      const response = await fetch("/api/interview/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scoringTable: scoreRows,
          metricTable: metricTable,
          questionSimulationReport: questionsReport,
          customPrompt: customEvalPrompt,
          apiKey: userApiKey,
          model: selectedModel,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Diagnostic report failed.");
      }

      setEvaluationReportText(data.report);
    } catch (err: any) {
      setInterviewError(err?.message || "Assessment narrative computation failure.");
    } finally {
      setIsEvaluatingInterview(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <StackingContainer>

        {/* Card #1: JD */}
        <StackingCard
          id="jd"
          title="Job Description"
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="interview_jd_editor" className="text-[10px] md:text-xs font-semibold text-[#6b7685] tracking-wider uppercase">
              Configure Target Role Job description (Default synced from audit)
            </label>
            <textarea
              id="interview_jd_editor"
              value={interviewJd}
              onChange={(e) => setInterviewJd(e.target.value)}
              rows={4}
              placeholder="Paste role description requirements..."
              className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none  transition-all"
            />
          </div>
        </StackingCard>

        {/* Card #2: Upload & Questions Generation */}
        <StackingCard
          id="uploads"
          title="Profile Extractor & Simulation Setup"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-4">
              <FileUploader
                id="interview_upload_resume"
                label="Candidate Resume context"
                placeholderText="Drop candidate resume or select"
                onTextLoaded={(text, filename) => {
                  setInterviewResumeText(text);
                  setInterviewResumeFileName(filename);
                }}
              />
              <FileUploader
                id="interview_upload_custom_prompt"
                label="Override Coach Question Prompt (Optional)"
                placeholderText="Override interview prompt"
                onTextLoaded={(text, filename) => {
                  setCustomInterviewPrompt(text);
                  setInterviewPromptFileName(filename);
                }}
              />
            </div>

            <div className="flex flex-col gap-3 justify-center">
              <p className="text-xs text-[#9aa3b0] leading-relaxed md:px-2 font-sans">
                The Coach uses advanced reasoning to formulate tailored questions highlighting mismatch, STAR behavior targets, and architectural problem scenarios.
              </p>

              <button
                onClick={handleGenerateQuestions}
                disabled={isGeneratingQuestions}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs md:text-sm uppercase tracking-widest py-3.5 px-4 rounded-[5px] active:scale-95 transition-all disabled:opacity-50"
              >
                {isGeneratingQuestions ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Generating Simulator...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 text-[#0a0c0d] fill-[#0a0c0d]" />
                    <span>Generate Tailored Questions</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {questionsReport && (
            <div className="mt-4 border-t border-[rgba(255,255,255,0.07)] pt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#6b7685] tracking-wider uppercase">Generated Simulator Context</span>
                <button
                  onClick={() => handleDownload("mock-interview-tasks.txt", questionsReport)}
                  className="text-[10px] font-semibold text-[#00d4dc] hover:underline flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Download Simulator Questions
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto p-4 bg-[#1c2128] rounded-[6px] border border-[rgba(255,255,255,0.07)] font-mono text-[11px] text-[#9aa3b0] whitespace-pre-wrap leading-relaxed">
                {questionsReport}
              </div>
            </div>
          )}
        </StackingCard>

        {/* Card #3: Dynamic Assessment Grading Box */}
        <StackingCard
          id="scoring"
          title="STAR Core Behavioral Rating Ledger"
        >
          <InterviewScoringTable
            scoreRows={scoreRows}
            onChange={(rows) => setScoreRows(rows)}
          />
        </StackingCard>

        {/* Card #4: Computed Performance Metrics summary */}
        <StackingCard
          id="metric"
          title="Consolidated Aggregate Metrics Preview"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">

            {/* Mean Score metric widget */}
            <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2 ">
              <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
                Aggregate Candidate Rating Average
              </span>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="text-4xl font-extrabold font-mono text-[#eef0f3] tracking-tight">
                  {currentMetrics.averageScore.toFixed(2)}
                </span>
                <span className="text-[#6b7685] text-xs font-mono">/ 1.00</span>
              </div>
              <div className="w-full bg-[#1c2128] h-2 rounded-full overflow-hidden mt-2">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${currentMetrics.averageScore >= 0.75
                      ? "bg-green-500"
                      : currentMetrics.averageScore < 0.5
                        ? "bg-red-500"
                        : "bg-amber-500"
                    }`}
                  style={{ width: `${currentMetrics.averageScore * 100}%` }}
                />
              </div>
            </div>

            {/* High performance widget */}
            <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2 ">
              <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
                Outstanding Skill Marks (≥ 0.75)
              </span>
              <span className="text-4xl font-extrabold font-mono text-green-600 mt-2">
                {currentMetrics.strongCount}
              </span>
              <p className="text-[11px] text-[#6b7685] mt-1 font-sans">
                Scores meeting or exceeding competitive target baseline metrics.
              </p>
            </div>

            {/* Areas of concern widget */}
            <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2 ">
              <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
                Priority Concerns Detected (&lt; 0.5)
              </span>
              <span className={`text-4xl font-extrabold font-mono mt-2 ${currentMetrics.weakCount > 0 ? "text-red-500 animate-pulse" : "text-[#eef0f3]"}`}>
                {currentMetrics.weakCount}
              </span>
              <p className="text-[11px] text-[#6b7685] mt-1 font-sans">
                Critical skills displaying material developmental deficiencies.
              </p>
            </div>

          </div>
        </StackingCard>

        {/* Card #5: Generate Diagnostic Evaluation Narrative Report */}
        <StackingCard
          id="report"
          title="Executive Diagnostic Narrative Report"
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FileUploader
                id="eval_custom_prompt"
                label="Upload Custom Diagnostic Prompt (Optional)"
                placeholderText="Drop customized assessor prompt"
                onTextLoaded={(text, filename) => {
                  setCustomEvalPrompt(text);
                  setEvalPromptFileName(filename);
                }}
              />

              <div className="flex flex-col gap-1.5 justify-center">
                <p className="text-xs text-[#9aa3b0] leading-relaxed font-sans">
                  Assess current grading values, metrics, and generated interview context to draft a tailored diagnostic assessment outlining recommendations and onboarding guidelines.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              {interviewError && (
                <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{interviewError}</span>
                </div>
              )}

              <button
                onClick={handleEvaluateInterview}
                disabled={isEvaluatingInterview}
                className="w-full relative flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs py-4 uppercase tracking-widest rounded-[5px] active:scale-98 transition-all disabled:opacity-50"
              >
                {isEvaluatingInterview ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>AI Coach is compiling analytics...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-[#0a0c0d]" />
                    <span>Compile Executive Assessment Report</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </StackingCard>

      </StackingContainer>

      {/* Generated Assessor Report Section - 90% Jelly Frosted Glass */}
      {evaluationReportText && (
        <section id="results-assessor-panel" className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] rounded-[10px] p-6 md:p-8  transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex flex-col gap-5 scroll-mt-24 text-[#eef0f3]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.07)] pb-4">
            <div>
              <h2 className="text-xl md:text-2xl font-semibold font-display text-[#eef0f3] tracking-tight">
                Executive Candidate Assessment Narrative
              </h2>
              <p className="text-xs text-[#6b7685] mt-1">
                Computed against STAR averages and Core competencies checklist.
              </p>
            </div>
            <button
              onClick={() => handleDownload("candidate-assessment-report.txt", evaluationReportText)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              Download Assessor Report
            </button>
          </div>

          <div className="bg-[#1c2128] rounded-[8px] p-5 md:p-6 border border-[rgba(255,255,255,0.07)] whitespace-pre-wrap text-sm text-[#9aa3b0] leading-relaxed font-sans">
            {evaluationReportText}
          </div>
        </section>
      )}
    </div>
  );
}
