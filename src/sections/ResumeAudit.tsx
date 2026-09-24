import React, { useState } from "react";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Download,
  Target,
  SlidersHorizontal,
} from "lucide-react";
import { ToolSection } from "../components/ToolSection";
import { toolReadiness } from "../lib/readiness";
import { CollapsibleSection } from "../components/CollapsibleSection";
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

/**
 * Normalise a marker before comparing it.
 *
 * Models routinely substitute a typographic apostrophe, and "What's Working" is
 * the one tab name containing an apostrophe — when that happened the marker and
 * its whole body were appended to the previous tab and the real tab read as
 * missing. Case is normalised for the same reason.
 */
const normaliseMarker = (s: string) => s.replace(/[‘’ʼ]/g, "'").toLowerCase();

/** Split the model's plain-text response on its [[Section]] markers. */
const parseSections = (rawText: string): ResumeReportSection[] => {
  const lines = rawText.split("\n");
  const sectionsMap: Record<string, string[]> = {};
  let currentMarker: string | null = null;

  lines.forEach((line) => {
    const stripped = normaliseMarker(line.trim());
    const matched = TAB_NAMES.find((tab) => stripped === normaliseMarker(`[[${tab}]]`));
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

  // Anchor on the label. An unanchored /(\d{1,3})\s*%/ takes the first
  // percentage anywhere in the section, so "Only 15% of the required keywords
  // appear. Callback Likelihood: 72%" read as 15 — and this is the single most
  // prominent number in the product.
  const labelled = section.content.match(/Callback\s+Likelihood\s*:?\s*(\d{1,3})\s*%/i);
  if (labelled) return clampPercent(labelled[1]);

  // Fallback for when the model drops the label: the first percentage that
  // isn't the upper bound of a range, so "on a 0-100% scale: 72%" reads 72.
  for (const m of section.content.matchAll(/(?:(\d{1,3})\s*[-–—]\s*)?(\d{1,3})\s*%/g)) {
    if (m[1] !== undefined) continue;
    return clampPercent(m[2]);
  }
  return null;
};

const clampPercent = (raw: string): number | null => {
  const value = parseInt(raw, 10);
  return value >= 0 && value <= 100 ? value : null;
};

const scoreTone = (p: number) => {
  if (p >= 70) return { tone: "text-good", bar: "bg-good" };
  if (p >= 40) return { tone: "text-warn", bar: "bg-warn" };
  return { tone: "text-mark", bar: "bg-mark" };
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

      <div className="border border-mark/20 bg-mark/10 rounded-control p-4 md:p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-mark font-display font-semibold text-[15px]">
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

  const lockedReason = toolReadiness(context, apiKey).audit;

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
      step="03"
      phase="Assessment"
      title="Resume Audit"
      subtitle="Your odds of a callback, and what to fix."
      lockedReason={lockedReason}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-ink-soft leading-relaxed measure">
            The first three tabs answer the questions that matter. The rest is the full report.
          </p>

          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="self-start inline-flex items-center justify-center gap-2 rounded-control bg-solid px-5 py-2.5 text-[15px] font-medium text-solid-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Auditing…</span>
              </>
            ) : (
              <>
                <Target className="w-4 h-4" />
                <span>Audit my resume</span>
              </>
            )}
          </button>

          <CollapsibleSection
            icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
            title="Override the audit prompt"
            subtitle="Optional — replace the built-in audit instructions with your own"
            badge={customPromptFileName || null}
          >
            <FileUploader
              id="audit_custom_prompt"
              label="Custom audit prompt"
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

        {report && (
          <div className="flex flex-col gap-5 border-t border-rule pt-5">
            {/* Headline callback score */}
            {callbackPercent !== null && (
              <div className="bg-sunken border border-rule rounded-control p-5 flex flex-col gap-3">
                <span className="text-xs font-bold text-ink-muted tracking-wider">
                  Callback likelihood for this role
                </span>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-5xl font-extrabold font-mono tracking-tight ${scoreTone(callbackPercent).tone}`}
                  >
                    {callbackPercent}%
                  </span>
                </div>
                <div className="w-full bg-surface h-2 rounded-full overflow-hidden">
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
                      className={`px-3 py-1.5 rounded-control text-[13px] font-semibold tracking-wide transition-all border ${
                        isActive
                          ? "bg-solid text-solid-ink border-solid font-medium"
                          : isHeadline
                            ? "text-accent border-accent/30 bg-accent/5 hover:bg-accent/15"
                            : "text-ink-soft border-rule hover:text-ink hover:bg-sunken"
                      }`}
                    >
                      {section.tabName}
                    </button>
                  );
                })}
              </div>

              <div className="bg-sunken rounded-control p-5 md:p-6 border border-rule min-h-[180px]">
                {activeSection && renderContent(activeSection.content)}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-ink-muted font-mono">Model: {report.modelUsed}</span>
              <button
                onClick={() => downloadText("resume-audit.txt", report.body)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent/10 hover:bg-accent/15 border border-accent/30 text-accent text-[15px] font-semibold transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Download full report
              </button>
            </div>
          </div>
        )}

        {!report && !isAnalyzing && (
          <p className="text-[13px] text-ink-muted flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            Results appear here once the audit runs.
          </p>
        )}
      </div>
    </ToolSection>
  );
};
