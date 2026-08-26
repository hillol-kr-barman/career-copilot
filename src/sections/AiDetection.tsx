import React, { useState } from "react";
import { ScanSearch, RefreshCw, AlertTriangle } from "lucide-react";
import { ToolSection } from "../components/ToolSection";

interface AiDetectionProps {
  resumeText: string;
}

interface DetectResult {
  aiProbability: number;
  engine: string;
}

const verdict = (p: number) => {
  if (p >= 70) return { label: "Likely AI-generated", tone: "text-red-500", bar: "bg-red-500" };
  if (p >= 40) return { label: "Mixed signals", tone: "text-[#fbbf24]", bar: "bg-amber-500" };
  return { label: "Reads as human-written", tone: "text-emerald-500", bar: "bg-emerald-500" };
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
      step="Tool 1"
      title="Resume AI Detection"
      subtitle="How much of your resume reads as AI-written — checked locally, no API key used"
      lockedReason={resumeText.trim() ? null : "Add your resume above to run the detector."}
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[#9aa3b0] leading-relaxed">
          Recruiters increasingly screen for AI-written applications. This runs six linguistic
          signals — sentence burstiness, vocabulary richness, AI-hallmark phrasing, transition
          density, sentence length and punctuation variety — entirely on the server, offline.
        </p>

        <button
          onClick={handleDetect}
          disabled={isDetecting}
          className="w-full md:w-auto md:self-start inline-flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs uppercase tracking-widest py-3.5 px-6 rounded-[5px] active:scale-95 transition-all disabled:opacity-50"
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
          <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && v && (
          <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-5 flex flex-col gap-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold font-mono text-[#eef0f3] tracking-tight">
                  {result.aiProbability}%
                </span>
                <span className="text-xs text-[#6b7685] font-mono">AI-likelihood</span>
              </div>
              <span className={`text-sm font-semibold ${v.tone}`}>{v.label}</span>
            </div>

            <div className="w-full bg-[#161a1e] h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-700 rounded-full ${v.bar}`}
                style={{ width: `${result.aiProbability}%` }}
              />
            </div>

            <p className="text-[11px] text-[#6b7685] leading-relaxed">
              Engine: <span className="font-mono text-[#9aa3b0]">{result.engine}</span>. This is a
              statistical estimate, not proof — heavily edited human writing and lightly edited AI
              writing both land in the middle band.
            </p>
          </div>
        )}
      </div>
    </ToolSection>
  );
};
