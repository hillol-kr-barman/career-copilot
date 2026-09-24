import React, { useState } from "react";
import { Check, PencilLine, Upload } from "lucide-react";
import { FileUploader } from "./FileUploader";
import { SharedContext } from "../types";

interface SharedInputsProps {
  context: SharedContext;
  onChange: (patch: Partial<SharedContext>) => void;
}

const field =
  "w-full rounded-control border border-rule bg-sunken px-3.5 py-3 text-[15px] text-ink " +
  "outline-none transition-colors placeholder:text-ink-muted hover:border-rule-strong " +
  "focus:border-accent focus:bg-surface";

/**
 * Step one: the document everything else reads.
 *
 * This is also the page's opening image. The subject of this whole tool is a
 * single sheet of paper being marked up, so the first thing on screen is that
 * sheet — and it is the control that starts the work, not a picture of one.
 */
export const SharedInputs: React.FC<SharedInputsProps> = ({ context, onChange }) => {
  const [pasteMode, setPasteMode] = useState(false);

  const resumeText = context.resumeText.trim();
  const resumeLoaded = resumeText.length > 0;

  return (
    <section id="your-details" aria-labelledby="your-details-title" className="flex flex-col gap-8">
      <header className="relative">
        <div
          aria-hidden="true"
          className="mb-5 flex items-baseline gap-3 md:absolute md:-left-40 md:top-1 md:mb-0 md:w-32 md:flex-col md:items-start md:gap-1"
        >
          <span className="tnum font-mono text-[26px] font-medium leading-none text-accent">
            01
          </span>
          <span className="label">Intake</span>
        </div>
        <h2 id="your-details-title" className="display text-[34px] md:text-[44px]">
          {resumeLoaded ? "Your document." : "Start with your resume."}
        </h2>
        <p className="measure mt-4 text-base leading-relaxed text-ink-soft">
          Add it once. Every step below reads this one document.
        </p>
      </header>

      {/* ── The sheet ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="label">Resume</h3>
          <button
            type="button"
            onClick={() => setPasteMode(!pasteMode)}
            className="inline-flex items-center gap-1.5 text-[15px] text-accent hover:underline underline-offset-4"
          >
            {pasteMode ? <Upload className="w-4 h-4" /> : <PencilLine className="w-4 h-4" />}
            {pasteMode ? "Upload a file instead" : "Paste the text instead"}
          </button>
        </div>

        {pasteMode ? (
          <textarea
            value={context.resumeText}
            onChange={(e) => onChange({ resumeText: e.target.value, resumeFileName: "" })}
            rows={12}
            aria-label="Resume text"
            placeholder="Paste your full resume here."
            className={`${field} font-mono text-[15px] leading-relaxed`}
          />
        ) : (
          <FileUploader
            id="shared_resume_upload"
            label=""
            placeholderText="Drop your resume here, or choose a file"
            existing={
              resumeLoaded
                ? {
                    name: context.resumeFileName || "Pasted text",
                    chars: resumeText.length,
                  }
                : null
            }
            onTextLoaded={(text, filename) =>
              onChange({ resumeText: text, resumeFileName: filename })
            }
          />
        )}

        {/* In paste mode the box itself shows nothing back, so the confirmation
            is the only signal the text registered. In upload mode the uploader
            already names the file and its length. */}
        {resumeLoaded && pasteMode && (
          <p className="flex items-center gap-2 text-[15px] text-good">
            <Check className="w-4 h-4 shrink-0" />
            <span className="tnum">{resumeText.length.toLocaleString()} characters ready.</span>
          </p>
        )}
      </div>

      {/* ── What it is being measured against ──────────────────────────── */}
      <div className="flex flex-col gap-6 border-t border-rule pt-8">
        <p className="text-[15px] text-ink-soft measure">
          Used by the audit and interview prep. The AI check doesn't need it.
        </p>

        <div className="flex flex-col gap-2">
          <label htmlFor="shared_jd" className="label">
            Job description
          </label>
          <textarea
            id="shared_jd"
            value={context.jobDescription}
            onChange={(e) => onChange({ jobDescription: e.target.value })}
            rows={7}
            placeholder="Paste the full job posting you are applying for."
            className={`${field} leading-relaxed`}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="shared_position" className="label">
            Position applied for
          </label>
          <input
            id="shared_position"
            type="text"
            value={context.appliedPosition}
            onChange={(e) => onChange({ appliedPosition: e.target.value })}
            placeholder="Senior Frontend Engineer"
            aria-describedby="shared_position_help"
            className={`${field} max-w-md`}
          />
          <p id="shared_position_help" className="text-sm text-ink-muted">
            Optional — taken from the job description if left blank.
          </p>
        </div>
      </div>
    </section>
  );
};
