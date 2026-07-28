import React, { useState } from "react";
import {
  Sparkles,
  CheckCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Download,
} from "lucide-react";
import { StackingContainer, StackingCard } from "../components/StackingContainer";
import { FileUploader } from "../components/FileUploader";
import { ResumeReportData, ResumeReportSection } from "../types";

interface LandingPageProps {
  resumeText: string;
  setResumeText: (val: string) => void;
  selectedModel: string;
  userApiKey: string;
}

// Split plain text response with headers into modular structured tabs if tags matches [[X]]
const parseSections = (rawText: string): ResumeReportSection[] => {
  const tabNames = [
    "JD Review", "Resume Review", "ATS Score", "JD Scorecard", "Resume Rewrite",
    "Strengthening", "Change Comparison", "Cover Letter", "Interview Preparation",
    "Iteration Tracking", "Readiness Analysis"
  ];

  const lines = rawText.split("\n");
  const sectionsMap: Record<string, string[]> = {};
  let currentMarker: string | null = null;

  lines.forEach((line) => {
    const stripped = line.trim();
    const matched = tabNames.find((tab) => stripped === `[[${tab}]]`);

    if (matched) {
      currentMarker = matched;
      sectionsMap[currentMarker] = [];
    } else if (currentMarker) {
      sectionsMap[currentMarker].push(line);
    }
  });

  // Check if we parsed successfully
  const parsedKeys = Object.keys(sectionsMap);
  if (parsedKeys.length > 0) {
    return tabNames.map((tab) => ({
      tabName: tab,
      title: tab,
      content: (sectionsMap[tab] || []).join("\n").trim() || "Information not generated for this version context.",
    }));
  }

  // Fallback split if the response didn't include markers: separate by markdown headings or list sections
  return tabNames.map((tab, i) => {
    if (i === 0) {
      return {
        tabName: tab,
        title: tab,
        content: rawText,
      };
    }
    return {
      tabName: tab,
      title: tab,
      content: "Please write specific prompts or configurations to request structured sections.",
    };
  });
};

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

// Highlight MMR block renderer helper
const renderHiglightedMMR = (text: string) => {
  const mmrStartIdx = text.indexOf("[[MMR_START]]");
  const mmrEndIdx = text.indexOf("[[MMR_END]]");

  if (mmrStartIdx === -1 || mmrEndIdx === -1 || mmrEndIdx <= mmrStartIdx) {
    return <div className="whitespace-pre-wrap text-sm text-white/80 leading-relaxed font-sans">{text}</div>;
  }

  const before = text.substring(0, mmrStartIdx);
  const mmrInner = text.substring(mmrStartIdx + "[[MMR_START]]".length, mmrEndIdx).trim();
  const after = text.substring(mmrEndIdx + "[[MMR_END]]".length);

  // Filter headers if any
  const formattedMMR = mmrInner.replace(/^(Mandatory Minimum Requirements:?\s*)/i, "").trim();

  return (
    <div className="flex flex-col gap-4">
      {before && <div className="whitespace-pre-wrap text-sm text-white/80 leading-relaxed font-sans">{before}</div>}

      <div className="border border-red-500/20 bg-red-500/10 rounded-[8px] p-4 md:p-5 flex flex-col gap-3 ">
        <div className="flex items-center gap-2 text-red-400 font-display font-semibold text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Mandatory Minimum Qualifications & Licenses Detected:
        </div>
        <div className="whitespace-pre-wrap text-xs md:text-sm font-semibold text-red-300 font-mono leading-relaxed bg-[#13161C] p-3 rounded-[5px] border border-red-500/10">
          {formattedMMR}
        </div>
      </div>

      {after && <div className="whitespace-pre-wrap text-sm text-white/80 leading-relaxed font-sans">{after}</div>}
    </div>
  );
};

export default function LandingPage({ resumeText, setResumeText, selectedModel, userApiKey }: LandingPageProps) {
  // AI Detection State
  const [aiDetectText, setAiDetectText] = useState<string>("");
  const [aiDetectFileName, setAiDetectFileName] = useState<string>("");
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [aiDetectResult, setAiDetectResult] = useState<{ aiProbability: number; engine: string; sentences?: Array<{ sentence: string; fakePercentage?: number }> } | null>(null);
  const [aiDetectError, setAiDetectError] = useState<string>("");

  // Inputs - Resume Mode
  const [resumeJd, setResumeJd] = useState<string>(
    `Role: Senior Software Engineer (Frontend)
Requirements:
- Minimum of 5 years of commercial experience in React/TypeScript
- Comprehensive experience with full-stack Node.js development
- Strong system architectural design patterns understanding`
  );
  const [customResumePrompt, setCustomResumePrompt] = useState<string>("");
  const [promptNotes, setPromptNotes] = useState<string>("");
  const [resumeFileName, setResumeFileName] = useState<string>("");
  const [customPromptFileName, setCustomPromptFileName] = useState<string>("");

  // Outputs - Resume Mode
  const [resumeReport, setResumeReport] = useState<ResumeReportData | null>(null);
  const [isAnalyzingResume, setIsAnalyzingResume] = useState<boolean>(false);
  const [resumeError, setResumeError] = useState<string>("");
  const [activeResumeReportTab, setActiveResumeReportTab] = useState<string>("JD Review");

  // Action: Analyze Resume API caller
  const handleAnalyzeResume = async () => {
    setResumeError("");
    if (!resumeJd.trim()) {
      setResumeError("Please supply a valid Job Description before running audit.");
      return;
    }
    if (!resumeText.trim()) {
      setResumeError("Please upload a resume file or enter raw candidate text in Card #2.");
      return;
    }

    setIsAnalyzingResume(true);
    setResumeReport(null);

    try {
      const response = await fetch("/api/resume/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: resumeJd,
          resumeText,
          customPrompt: customResumePrompt,
          promptNotes,
          apiKey: userApiKey,
          model: selectedModel,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Server-side analysis error.");
      }

      const rawReport = data.report;
      const tabSections = parseSections(rawReport);

      setResumeReport({
        body: rawReport,
        tabSections,
        modelUsed: data.modelUsed,
      });

      // Default active subtab to direct report findings
      setActiveResumeReportTab("JD Review");
    } catch (err: any) {
      setResumeError(err?.message || "Critical error connecting with server model.");
    } finally {
      setIsAnalyzingResume(false);
    }
  };

  // Action: AI content rate detection
  const handleAiDetect = async () => {
    setAiDetectError("");
    setAiDetectResult(null);
    if (!aiDetectText.trim()) {
      setAiDetectError("Please upload a file or paste text to detect.");
      return;
    }
    setIsDetecting(true);
    try {
      const response = await fetch("/api/ai-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiDetectText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Detection failed.");
      setAiDetectResult(data);
    } catch (err: any) {
      setAiDetectError(err?.message || "Detection service unavailable.");
    } finally {
      setIsDetecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">

      {/* AI CONTENT DETECTION CARD */}
      <div className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] p-5 md:p-6 rounded-[10px]  transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[rgba(255,255,255,0.07)]">
          <div className="p-2.5  bg-[rgba(0,212,220,0.08)] border border-[rgba(0,212,220,0.2)] rounded-[8px] shrink-0">
            <CheckCircle2 className="w-5 h-5 text-[#00d4dc]" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[#eef0f3] tracking-tight flex items-center gap-2">
              AI Content Detection
              <span className="text-[10px] bg-[rgba(0,212,220,0.12)] text-[#00d4dc] font-mono font-semibold px-2 py-0.5 rounded-[4px] uppercase tracking-wider">Zero-Shot</span>
            </h3>
            <p className="text-xs text-[#6b7685] mt-0.5">
              Upload or paste document text to detect AI-generated content rate before audit.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Left: upload + paste */}
          <div className="flex flex-col gap-3">
            <FileUploader
              id="ai_detect_file"
              label="Upload Document to Check"
              placeholderText="Drop file to extract text for AI detection"
              onTextLoaded={(text, filename) => {
                setAiDetectText(text);
                setAiDetectFileName(filename);
                setAiDetectResult(null);
                setAiDetectError("");
              }}
            />
            <textarea
              value={aiDetectText}
              onChange={(e) => { setAiDetectText(e.target.value); setAiDetectResult(null); }}
              rows={4}
              placeholder="Or paste text here directly..."
              className="w-full text-xs text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[6px] p-3 focus:outline-none focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] resize-none font-mono leading-relaxed"
            />
            {aiDetectFileName && (
              <span className="text-[10px] font-medium text-[#00d4dc] bg-[rgba(0,212,220,0.1)] px-2 py-0.5 rounded-[4px] border border-[rgba(0,212,220,0.25)] w-fit">
                ✓ {aiDetectFileName}
              </span>
            )}

            {aiDetectError && (
              <div className="p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-[6px] text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{aiDetectError}</span>
              </div>
            )}

            <button
              onClick={handleAiDetect}
              disabled={isDetecting || !aiDetectText.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs uppercase tracking-widest py-3.5 rounded-[5px] active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {isDetecting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Detecting...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Check AI Rate</span>
                </>
              )}
            </button>
          </div>

          {/* Right: result display */}
          <div className="flex flex-col items-center justify-center bg-[#1c2128] rounded-[8px] border border-[rgba(255,255,255,0.07)] p-5 min-h-[200px]">
            {!aiDetectResult && !isDetecting && (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-16 h-16 rounded-full border-4 border-dashed border-[rgba(255,255,255,0.07)] flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-[#6b7685]" />
                </div>
                <p className="text-xs text-[#6b7685] font-sans max-w-[180px] leading-relaxed">
                  Upload or paste text and click <b className="text-[#9aa3b0]">Check AI Rate</b> to scan.
                </p>
              </div>
            )}

            {isDetecting && (
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full border-4 border-[rgba(0,212,220,0.25)] border-t-[#00d4dc] animate-spin" />
                <p className="text-xs text-[#6b7685]">Analyzing content patterns...</p>
              </div>
            )}

            {aiDetectResult && !isDetecting && (() => {
              const pct = aiDetectResult.aiProbability;
              const isHigh = pct >= 70;
              const isMid = pct >= 40 && pct < 70;
              const color = isHigh ? "text-red-500" : isMid ? "text-amber-500" : "text-emerald-500";
              const bgColor = isHigh ? "bg-red-500" : isMid ? "bg-amber-500" : "bg-emerald-500";
              const borderColor = isHigh ? "border-red-200" : isMid ? "border-[rgba(251,191,36,0.3)]" : "border-[rgba(16,185,129,0.3)]";
              const label = isHigh ? "Likely AI-Generated" : isMid ? "Possibly AI-Assisted" : "Likely Human-Written";
              return (
                <div className="w-full flex flex-col items-center gap-4">
                  {/* Circular gauge */}
                  <div className={`relative w-28 h-28 rounded-full border-4 ${borderColor} flex items-center justify-center bg-[#161a1e]`}>
                    <div className="flex flex-col items-center">
                      <span className={`text-3xl font-extrabold font-mono tracking-tight ${color}`}>{pct}%</span>
                      <span className="text-[9px] font-bold text-[#6b7685] uppercase tracking-wider mt-0.5">AI Rate</span>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-[#1c2128] h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${bgColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {/* Label */}
                  <div className={`text-xs font-bold uppercase tracking-wider ${color}`}>{label}</div>
                  {/* Engine badge */}
                  <span className="text-[10px] text-[#6b7685] font-mono bg-[#1c2128] border border-[rgba(255,255,255,0.07)] px-2 py-0.5 rounded-[4px]">
                    Engine: {aiDetectResult.engine}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <StackingContainer>

        {/* Card #1: Job Description */}
        <StackingCard
          id="jd"
          title="Job Description"
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="resume_jd_editor" className="text-[10px] md:text-xs font-semibold text-[#6b7685] uppercase tracking-wider">
              Copy and Paste Requirements / Job Description
            </label>
            <textarea
              id="resume_jd_editor"
              value={resumeJd}
              onChange={(e) => setResumeJd(e.target.value)}
              rows={6}
              placeholder="Candidate target role details..."
              className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4 md:p-5 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none  transition-all"
            />
            <div className="flex justify-between items-center text-[10px] text-[#6b7685] font-mono mt-1">
              <span>WORD COUNT: {resumeJd.trim().split(/\s+/).filter(Boolean).length}</span>
              <span>MAX PREVIEW CAP: 4000 CHARS</span>
            </div>
          </div>
        </StackingCard>

        {/* Card #2: Upload Resume */}
        <StackingCard
          id="uploads"
          title="Document Upload & Extraction"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-4">
              <FileUploader
                id="upload_resume_file"
                label="Candidate Resume Document"
                placeholderText="Drop candidate resume or select"
                onTextLoaded={(text, filename) => {
                  setResumeText(text);
                  setResumeFileName(filename);
                }}
              />
              <FileUploader
                id="upload_custom_prompt"
                label="Override Base Prompt (Optional)"
                placeholderText="Drop custom analyst prompt file"
                onTextLoaded={(text, filename) => {
                  setCustomResumePrompt(text);
                  setCustomPromptFileName(filename);
                }}
              />
            </div>

            <div className="flex flex-col gap-2 bg-[#1c2128] p-4 rounded-[8px] border border-[rgba(255,255,255,0.07)] ">
              <span className="text-[9px] font-bold text-[#6b7685] tracking-wider uppercase">
                Extracted Text Stream Preview
              </span>
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                rows={6}
                placeholder="Upload file to view stream, or type raw candidate context directly here..."
                className="w-full text-xs text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[6px] p-3 focus:outline-none focus:ring-2 focus:ring-[rgba(0,212,220,0.2)] focus:border-[#00d4dc] outline-none resize-none flex-1 font-mono leading-relaxed"
              />
              {resumeFileName && (
                <span className="text-[10px] font-medium text-[#00d4dc] bg-[rgba(0,212,220,0.1)] px-2 py-0.5 rounded-[4px] border border-[rgba(0,212,220,0.25)] w-fit">
                  ✓ Raw Data Source: {resumeFileName}
                </span>
              )}
            </div>
          </div>
        </StackingCard>

        {/* Card #3: Prompt Notes & Generate Audit */}
        <StackingCard
          id="notes"
          title="Prompt Orchestration Notes"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] md:text-xs font-semibold text-[#6b7685] uppercase tracking-wider">
                Special context context (e.g. "Highlight leadership credentials", "Emphasize consulting gaps")
              </label>
              <textarea
                value={promptNotes}
                onChange={(e) => setPromptNotes(e.target.value)}
                rows={3}
                placeholder="Add personalized context instructions..."
                className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none  transition-all"
              />
            </div>

            <div className="flex flex-col gap-3 pt-2">
              {resumeError && (
                <div className="p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-[6px] text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{resumeError}</span>
                </div>
              )}

              <button
                onClick={handleAnalyzeResume}
                disabled={isAnalyzingResume}
                className="w-full relative flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs md:text-sm uppercase tracking-widest py-4 rounded-[5px] active:scale-98 transition-all disabled:opacity-55 disabled:pointer-events-none"
              >
                {isAnalyzingResume ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>AI Coach is processing models... Please Wait</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-[#0a0c0d] animate-pulse" />
                    <span>Generate Dynamic Resume Audit</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </StackingCard>

      </StackingContainer>

      {/* Resume Report Sections Tabs - 90% Jelly Frosted glass */}
      {resumeReport && (
        <section id="results-panel" className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] rounded-[10px] p-6 md:p-8  transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex flex-col gap-6 scroll-mt-24 text-[#eef0f3]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.07)] pb-4">
            <div>
              <h2 className="text-xl md:text-2xl font-semibold font-display text-[#eef0f3] tracking-tight">
                Generated Dynamic Resume Report
              </h2>
              <p className="text-xs text-[#6b7685] mt-1">
                Report outputs parsed into optimized tabs. Model used: <span className="font-mono text-[11px] font-bold text-[#00d4dc] bg-[rgba(0,212,220,0.08)] px-2 py-0.5 rounded border border-[rgba(0,212,220,0.2)]">{resumeReport.modelUsed}</span>
              </p>
            </div>
            <button
              onClick={() => handleDownload("resume-review-report.txt", resumeReport.body)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              Download Standard Report
            </button>
          </div>

          <div className="flex flex-wrap gap-1 border-b border-[rgba(255,255,255,0.07)] pb-2">
            {resumeReport.tabSections.map((section) => (
              <button
                key={section.tabName}
                onClick={() => setActiveResumeReportTab(section.tabName)}
                className={`text-[9px] md:text-[11px] font-semibold tracking-wider uppercase px-3 py-1.5 rounded-[5px] border transition-all ${activeResumeReportTab === section.tabName
                    ? "bg-[#00d4dc] text-[#0a0c0d] border-[#00d4dc] "
                    : "bg-[#1c2128] text-[#9aa3b0] border-[rgba(255,255,255,0.07)] hover:bg-[#1c2128] hover:text-[#eef0f3]"
                  }`}
              >
                {section.tabName}
              </button>
            ))}
          </div>

          <div className="bg-[#1c2128] rounded-[8px] p-5 md:p-6 border border-[rgba(255,255,255,0.07)] min-h-[250px] transition-all">
            {/* Select corresponding tab content */}
            {(() => {
              const activeSec = resumeReport.tabSections.find(s => s.tabName === activeResumeReportTab);
              if (!activeSec) return null;

              if (activeResumeReportTab === "JD Review") {
                return renderHiglightedMMR(activeSec.content);
              }

              return (
                <div className="whitespace-pre-wrap text-sm text-[#9aa3b0] leading-relaxed font-sans">
                  {activeSec.content}
                </div>
              );
            })()}
          </div>
        </section>
      )}
    </div>
  );
}
