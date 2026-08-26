import React, { useState } from "react";
import { FileCheck2, PencilLine } from "lucide-react";
import { FileUploader } from "./FileUploader";
import { SharedContext } from "../types";

interface SharedInputsProps {
  context: SharedContext;
  onChange: (patch: Partial<SharedContext>) => void;
}

/**
 * The single place a candidate enters their details.
 *
 * Everything below on the page reads from this one context — the resume is
 * uploaded exactly once per session and reused by all three tools.
 */
export const SharedInputs: React.FC<SharedInputsProps> = ({ context, onChange }) => {
  const [pasteMode, setPasteMode] = useState(false);

  const resumeLoaded = context.resumeText.trim().length > 0;

  return (
    <section
      id="your-details"
      className="w-full rounded-[10px] bg-[#161a1e] border border-[rgba(255,255,255,0.07)] p-5 md:p-7 flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.07)] pb-4">
        <div className="flex items-center gap-2.5">
          <span className="px-2.5 py-0.5 text-[9px] md:text-xs font-semibold tracking-wider uppercase rounded-[4px] border text-[#00d4dc] bg-[rgba(0,212,220,0.08)] border-[rgba(0,212,220,0.2)]">
            Step 1
          </span>
          <h2 className="text-base md:text-lg font-medium tracking-tight text-[#eef0f3]">
            Your details
          </h2>
        </div>
        <p className="text-[10px] md:text-xs text-[#6b7685]">
          Entered once — all three tools below use it
        </p>
      </div>

      {/* ── Resume ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] md:text-xs font-semibold tracking-wider text-[#6b7685] uppercase">
            Resume
          </span>
          <button
            type="button"
            onClick={() => setPasteMode(!pasteMode)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#00d4dc] hover:underline"
          >
            <PencilLine className="w-3 h-3" />
            {pasteMode ? "Upload a file instead" : "Paste text instead"}
          </button>
        </div>

        {pasteMode ? (
          <textarea
            value={context.resumeText}
            onChange={(e) => onChange({ resumeText: e.target.value, resumeFileName: "" })}
            rows={10}
            placeholder="Paste your full resume text here..."
            className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none transition-all font-mono leading-relaxed"
          />
        ) : (
          <FileUploader
            id="shared_resume_upload"
            label=""
            placeholderText="Drop your resume, or click to choose a file"
            onTextLoaded={(text, filename) => onChange({ resumeText: text, resumeFileName: filename })}
          />
        )}

        {resumeLoaded && (
          <div className="flex items-center gap-2 text-[11px] text-emerald-500 bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)] rounded-[6px] px-3 py-2">
            <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              Resume ready
              {context.resumeFileName ? ` — ${context.resumeFileName}` : " — pasted text"} ·{" "}
              {context.resumeText.trim().length.toLocaleString()} characters
            </span>
          </div>
        )}
      </div>

      {/* ── Job description ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="shared_jd"
          className="text-[10px] md:text-xs font-semibold tracking-wider text-[#6b7685] uppercase"
        >
          Job description
          <span className="normal-case tracking-normal font-normal text-[#6b7685]/70">
            {" "}
            — needed by Resume Audit and Interview Prep
          </span>
        </label>
        <textarea
          id="shared_jd"
          value={context.jobDescription}
          onChange={(e) => onChange({ jobDescription: e.target.value })}
          rows={6}
          placeholder="Paste the full job description you're applying for..."
          className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none transition-all leading-relaxed"
        />
      </div>

      {/* ── Position applied for ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="shared_position"
          className="text-[10px] md:text-xs font-semibold tracking-wider text-[#6b7685] uppercase"
        >
          Position applied for
          <span className="normal-case tracking-normal font-normal text-[#6b7685]/70">
            {" "}
            — optional; inferred from the job description if left blank
          </span>
        </label>
        <input
          id="shared_position"
          type="text"
          value={context.appliedPosition}
          onChange={(e) => onChange({ appliedPosition: e.target.value })}
          placeholder="e.g. Senior Frontend Engineer"
          className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-3 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none transition-all"
        />
        <p className="text-[10px] text-[#6b7685]">
          Your education is read straight from your resume — no need to enter it again.
        </p>
      </div>
    </section>
  );
};
