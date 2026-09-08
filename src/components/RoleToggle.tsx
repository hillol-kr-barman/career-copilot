import React from "react";
import type { Speaker } from "../types";

interface RoleToggleProps {
  declaredSpeaker: Speaker;
  onDeclaredSpeakerChange: (speaker: Speaker) => void;
  disabled: boolean;
}

/**
 * Single toggle where the operator declares which of the two sides they are,
 * once, before recording (D-24). This is informational only now — there is
 * one microphone track carrying both people, and nothing about it changes
 * based on this declaration; it exists so downstream consumers (Phase 6's
 * "what the candidate said" analysis) can read the operator's own side
 * straight off the session record.
 *
 * Two independently-tabbable native buttons rather than a full ARIA
 * `radiogroup` with roving tabindex — the simpler, equally-accessible
 * pattern; Enter and Space operate them by default.
 *
 * Locked for the whole session once recording starts (Probe addition,
 * 2026-09-01): a wrong declaration poisons the Phase 5 transcript and the
 * Phase 6 analysis, so nothing about who declared what is allowed to change
 * mid-interview. It does not re-enable on stop.
 */
export const RoleToggle: React.FC<RoleToggleProps> = ({
  declaredSpeaker,
  onDeclaredSpeakerChange,
  disabled,
}) => {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#6b7685]">
        Your role in this interview
      </span>

      <div className="rounded-[6px] border border-[rgba(255,255,255,0.07)] overflow-hidden inline-flex w-fit">
        <button
          type="button"
          aria-pressed={declaredSpeaker === "candidate"}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => onDeclaredSpeakerChange("candidate")}
          className={`px-4 py-2.5 text-sm transition-all disabled:opacity-50 ${
            declaredSpeaker === "candidate"
              ? "bg-[#00d4dc] text-[#0a0c0d] font-semibold"
              : "bg-[#1c2128] text-[#9aa3b0] hover:text-[#eef0f3]"
          }`}
        >
          I'm the candidate
        </button>
        <button
          type="button"
          aria-pressed={declaredSpeaker === "interviewer"}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => onDeclaredSpeakerChange("interviewer")}
          className={`px-4 py-2.5 text-sm transition-all disabled:opacity-50 ${
            declaredSpeaker === "interviewer"
              ? "bg-[#00d4dc] text-[#0a0c0d] font-semibold"
              : "bg-[#1c2128] text-[#9aa3b0] hover:text-[#eef0f3]"
          }`}
        >
          I'm the interviewer
        </button>
      </div>

      <p className="text-xs text-[#9aa3b0] leading-relaxed">
        This is recorded once, before you start — it doesn't change which audio is captured. One
        microphone records both of you; the spacebar marks who is currently speaking.
      </p>

      <p className="text-xs text-[#6b7685] leading-relaxed">
        A panel of interviewers shares the one Interviewer side of the spacebar toggle —
        per-panellist controls aren't available yet.
      </p>

      {disabled && (
        <p className="text-xs text-[#6b7685] leading-relaxed">
          Locked while recording — set for the whole session.
        </p>
      )}
    </div>
  );
};
