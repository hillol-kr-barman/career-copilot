import React, { useState } from "react";
import { ScanSearch, RefreshCw, AlertTriangle } from "lucide-react";
import { ToolSection } from "../components/ToolSection";
import { toolReadiness } from "../lib/readiness";

interface AiDetectionProps {
  resumeText: string;
}

interface DetectResult {
  aiProbability: number;
  engine: string;
}

const verdict = (p: number) => {
  if (p >= 70) return { label: "Likely AI-generated", tone: "text-mark", bar: "bg-mark" };
  if (p >= 40) return { label: "Mixed signals", tone: "text-warn", bar: "bg-warn" };
  return { label: "Reads as human-written", tone: "text-good", bar: "bg-good" };
};

/**
 * Tool 1 — runs the local statistical detector over the shared resume.
 * No API key needed: /api/ai-detect never calls out to a model.
 */
export const AiDetection: React.FC<AiDetectionProps> = ({ resumeText }) => {
  const [isDetecting, setIsDetecting] = useState(false);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [error, setError] = useState("");

  const handleDetect = async () => {
    setError("");
    setResult(null);
    setIsDetecting(true);

    try {
      const response = await fetch("/api/ai-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: resumeText }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Detection failed.");

      setResult({ aiProbability: data.aiProbability, engine: data.engine });
    } catch (err: any) {
      setError(err?.message || "Detection service unavailable.");
    } finally {
      setIsDetecting(false);
    }
  };

  const v = result ? verdict(result.aiProbability) : null;

  return (
    <ToolSection
      id="tool-ai-detection"
      step="02"
      phase="Screening"
      title="Resume AI Detection"
      subtitle="Checked locally. No API key used."
      lockedReason={toolReadiness({ resumeText }, "").detection}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          Five signals, measured offline. A heuristic, not proof — careful human writing scores
          high, plain LLM writing scores low. A reason to look closer, not a verdict.
        </p>

        <button
          onClick={handleDetect}
          disabled={isDetecting}
          className="self-start inline-flex items-center justify-center gap-2 rounded-control bg-solid px-5 py-2.5 text-[15px] font-medium text-solid-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isDetecting ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Scanning…</span>
            </>
          ) : (
            <>
              <ScanSearch className="w-3.5 h-3.5" />
              <span>Scan my resume</span>
            </>
          )}
        </button>

        {error && (
          <p className="flex items-start gap-2 border-l-2 border-mark py-1 pl-3 text-[15px] text-mark measure">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        {result && v && (
          <div className="flex measure flex-col gap-4 rounded-control border border-rule bg-sunken/60 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <p className="flex items-baseline gap-2.5">
                {/* Serif, because this is the one number the whole tool exists
                    to report — and tabular so it doesn't shift while animating. */}
                <span className="text-5xl leading-none text-ink tnum">{result.aiProbability}%</span>
                <span className="text-[15px] text-ink-soft">reads as AI-written</span>
              </p>
              <span className={`text-[15px] font-medium ${v.tone}`}>{v.label}</span>
            </div>

            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-rule"
              role="img"
              aria-label={`${result.aiProbability} percent of one hundred`}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-700 ${v.bar}`}
                style={{ width: `${result.aiProbability}%` }}
              />
            </div>

            <p className="text-sm leading-relaxed text-ink-muted measure">
              Measured by the {result.engine}. This is a statistical estimate, not proof — heavily
              edited human writing and lightly edited AI writing both land in the middle band.
            </p>
          </div>
        )}
      </div>
    </ToolSection>
  );
};
