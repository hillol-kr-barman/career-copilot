import React, { useState } from "react";
import { Sparkles, RefreshCw, AlertTriangle, Download, Target } from "lucide-react";
import { ToolSection } from "../components/ToolSection";
import { FileUploader } from "../components/FileUploader";
import { downloadText } from "../lib/download";
import { RenderMarkdown } from "../lib/renderMarkdown";
import { ResumeReportData, ResumeReportSection, SharedContext } from "../types";

interface ResumeAuditProps {
  context: SharedContext;
  apiKey: string;
}

/**
 * Section order is the contract with DEFAULT_RESUME_PROMPT in server.ts.
 * The first three are the headline answers; the rest is the full-depth report.
 */
const TAB_NAMES = [
  "Callback Score",
  "What's Working",
  "What to Fix",
  "JD Review",
  "Resume Review",
  "JD Scorecard",
  "Resume Rewrite",
  "Strengthening",
  "Change Comparison",
  "Cover Letter",
  "Interview Preparation",
  "Iteration Tracking",
  "Readiness Analysis",
];

const HEADLINE_TABS = TAB_NAMES.slice(0, 3);

/** Split the model's plain-text response on its [[Section]] markers. */
const parseSections = (rawText: string): ResumeReportSection[] => {
  const lines = rawText.split("\n");
  const sectionsMap: Record<string, string[]> = {};
  let currentMarker: string | null = null;

  lines.forEach((line) => {
    const stripped = line.trim();
    const matched = TAB_NAMES.find((tab) => stripped === `[[${tab}]]`);
    if (matched) {
      currentMarker = matched;
      sectionsMap[currentMarker] = [];
    } else if (currentMarker) {
      sectionsMap[currentMarker].push(line);
    }
  });

  if (Object.keys(sectionsMap).length > 0) {
    return TAB_NAMES.map((tab) => ({
      tabName: tab,
      title: tab,
      content:
        (sectionsMap[tab] || []).join("\n").trim() ||
        "The model did not return this section. Try re-running the audit.",
    }));
  }

  // The model ignored the markers — show its whole reply rather than losing it.
  return TAB_NAMES.map((tab, i) => ({
    tabName: tab,
    title: tab,
    content:
      i === 0
        ? rawText
        : "The model returned an unstructured response — the full text is under Callback Score.",
  }));
};

/** Pull "Callback Likelihood: 72%" out of the first section for the big readout. */
const extractCallbackPercent = (sections: ResumeReportSection[]): number | null => {
  const section = sections.find((s) => s.tabName === "Callback Score");
  if (!section) return null;
  const match = section.content.match(/(\d{1,3})\s*%/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return value >= 0 && value <= 100 ? value : null;
};

const scoreTone = (p: number) => {
  if (p >= 70) return { tone: "text-emerald-500", bar: "bg-emerald-500" };
  if (p >= 40) return { tone: "text-[#fbbf24]", bar: "bg-amber-500" };
  return { tone: "text-red-500", bar: "bg-red-500" };
};

/** Render a section, styling any [[MMR_START]]…[[MMR_END]] block as a red callout. */
const renderContent = (text: string) => {
  const startIdx = text.indexOf("[[MMR_START]]");
  const endIdx = text.indexOf("[[MMR_END]]");

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return <RenderMarkdown text={text} />;
  }

  const before = text.substring(0, startIdx);
  const inner = text.substring(startIdx + "[[MMR_START]]".length, endIdx).trim();
  const after = text.substring(endIdx + "[[MMR_END]]".length);
  const formatted = inner.replace(/^(Mandatory Minimum Requirements:?\s*)/i, "").trim();

  return (
    <div className="flex flex-col gap-4">
      {before.trim() && <RenderMarkdown text={before.trim()} />}

      <div className="border border-red-500/20 bg-red-500/10 rounded-[8px] p-4 md:p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-red-400 font-display font-semibold text-sm">
          <AlertTriangle className="w-4 h-4" />
          Mandatory Minimum Requirements
        </div>
        <RenderMarkdown text={formatted} />
      </div>

      {after.trim() && <RenderMarkdown text={after.trim()} />}
    </div>
  );
};

export const ResumeAudit: React.FC<ResumeAuditProps> = ({ context, apiKey }) => {
  const [report, setReport] = useState<ResumeReportData | null>(null);
  const [activeTab, setActiveTab] = useState<string>(TAB_NAMES[0]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPromptFileName, setCustomPromptFileName] = useState("");

  const lockedReason = !context.resumeText.trim()
    ? "Add your resume above to run the audit."
    : !context.jobDescription.trim()
      ? "Paste the job description above to run the audit."
      : !apiKey.trim()
        ? "Connect your API key at the top of the page to run the audit."
        : null;

  const handleAnalyze = async () => {
    setError("");
    setIsAnalyzing(true);
    setReport(null);

    try {
      const response = await fetch("/api/resume/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: context.jobDescription,
          resumeText: context.resumeText,
          customPrompt,
          apiKey,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Audit failed.");

      setReport({
        body: data.report,
        tabSections: parseSections(data.report),
        rawResponse: data.report,
        modelUsed: data.modelUsed,
      });
      setActiveTab(TAB_NAMES[0]);
    } catch (err: any) {
      setError(err?.message || "Could not reach the model.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const callbackPercent = report ? extractCallbackPercent(report.tabSections) : null;
  const activeSection = report?.tabSections.find((s) => s.tabName === activeTab);

  return (
    <ToolSection
      id="tool-resume-audit"
      step="Tool 2"
      title="Resume Audit"
      subtitle="Your odds of a callback for this job — plus what's working and exactly what to fix"
      lockedReason={lockedReason}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          <FileUploader
            id="audit_custom_prompt"
            label="Override the audit prompt (optional)"
            placeholderText="Drop a custom prompt file"
            onTextLoaded={(text, filename) => {
              setCustomPrompt(text);
              setCustomPromptFileName(filename);
            }}
          />

          <div className="flex flex-col gap-3 justify-center">
            <p className="text-xs text-[#9aa3b0] leading-relaxed">
              Your resume is scored against this specific job description. The first three tabs
              answer the questions that matter; the remaining ten hold the full report.
            </p>
            {customPromptFileName && (
              <p className="text-[11px] text-[#00d4dc] font-mono">
                Using custom prompt: {customPromptFileName}
              </p>
            )}
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs uppercase tracking-widest py-3.5 px-4 rounded-[5px] active:scale-95 transition-all disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Auditing…</span>
                </>
              ) : (
                <>
                  <Target className="w-3.5 h-3.5" />
                  <span>Audit my resume</span>
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {report && (
          <div className="flex flex-col gap-5 border-t border-[rgba(255,255,255,0.07)] pt-5">
            {/* Headline callback score */}
            {callbackPercent !== null && (
              <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-5 flex flex-col gap-3">
                <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
                  Callback likelihood for this role
                </span>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-5xl font-extrabold font-mono tracking-tight ${scoreTone(callbackPercent).tone}`}
                  >
                    {callbackPercent}%
                  </span>
                </div>
                <div className="w-full bg-[#161a1e] h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 rounded-full ${scoreTone(callbackPercent).bar}`}
                    style={{ width: `${callbackPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Tabs — headline three first, then the full report */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {report.tabSections.map((section) => {
                  const isHeadline = HEADLINE_TABS.includes(section.tabName);
                  const isActive = activeTab === section.tabName;
                  return (
                    <button
                      key={section.tabName}
                      onClick={() => setActiveTab(section.tabName)}
                      className={`px-3 py-1.5 rounded-[5px] text-[11px] font-semibold tracking-wide transition-all border ${
                        isActive
                          ? "bg-[#00d4dc] text-[#0a0c0d] border-[#00d4dc] font-bold"
                          : isHeadline
                            ? "text-[#00d4dc] border-[rgba(0,212,220,0.25)] bg-[rgba(0,212,220,0.06)] hover:bg-[rgba(0,212,220,0.12)]"
                            : "text-[#9aa3b0] border-[rgba(255,255,255,0.07)] hover:text-[#eef0f3] hover:bg-[#1c2128]"
                      }`}
                    >
                      {section.tabName}
                    </button>
                  );
                })}
              </div>

              <div className="bg-[#1c2128] rounded-[8px] p-5 md:p-6 border border-[rgba(255,255,255,0.07)] min-h-[180px]">
                {activeSection && renderContent(activeSection.content)}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[10px] text-[#6b7685] font-mono">
                Model: {report.modelUsed}
              </span>
              <button
                onClick={() => downloadText("resume-audit.txt", report.body)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95"
              >
                <Download className="w-3.5 h-3.5" />
                Download full report
              </button>
            </div>
          </div>
        )}

        {!report && !isAnalyzing && (
          <p className="text-[11px] text-[#6b7685] flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            Results appear here once the audit runs.
          </p>
        )}
      </div>
    </ToolSection>
  );
};
