import React from "react";
import type { UserRole } from "../types";

interface RoleToggleProps {
  role: UserRole;
  onRoleChange: (role: UserRole) => void;
  disabled: boolean;
}

/** Updates immediately on toggle — names which physical stream carries which label. */
const HELPER_TEXT: Record<UserRole, string> = {
  candidate:
    "Your microphone will be labelled Candidate. The shared tab's audio will be labelled Interviewer.",
  interviewer:
    "Your microphone will be labelled Interviewer. The shared tab's audio will be labelled Candidate.",
};

/**
 * Single toggle deciding which captured stream is "candidate" and which is
 * "interviewer" (D-07). State lives in the parent — the section needs the
 * value to label both streams and to persist it on the session record.
 *
 * Two independently-tabbable native buttons rather than a full ARIA
 * `radiogroup` with roving tabindex — the simpler, equally-accessible
 * pattern; Enter and Space operate them by default.
 *
 * Locked for the whole session once recording starts (Probe addition,
 * 2026-09-01): a mislabelled stream poisons the Phase 5 transcript and the
 * Phase 6 analysis, so nothing about who is at the laptop is allowed to
 * change mid-interview. It does not re-enable on stop.
 */
export const RoleToggle: React.FC<RoleToggleProps> = ({ role, onRoleChange, disabled }) => {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#6b7685]">
        Your role in this interview
      </span>

      <div className="rounded-[6px] border border-[rgba(255,255,255,0.07)] overflow-hidden inline-flex w-fit">
        <button
          type="button"
          aria-pressed={role === "candidate"}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => onRoleChange("candidate")}
          className={`px-4 py-2.5 text-sm transition-all disabled:opacity-50 ${
            role === "candidate"
              ? "bg-[#00d4dc] text-[#0a0c0d] font-semibold"
              : "bg-[#1c2128] text-[#9aa3b0] hover:text-[#eef0f3]"
          }`}
        >
          I'm the candidate
        </button>
        <button
          type="button"
          aria-pressed={role === "interviewer"}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => onRoleChange("interviewer")}
          className={`px-4 py-2.5 text-sm transition-all disabled:opacity-50 ${
            role === "interviewer"
              ? "bg-[#00d4dc] text-[#0a0c0d] font-semibold"
              : "bg-[#1c2128] text-[#9aa3b0] hover:text-[#eef0f3]"
          }`}
        >
          I'm the interviewer
        </button>
      </div>

      <p className="text-xs text-[#9aa3b0] leading-relaxed">{HELPER_TEXT[role]}</p>

      <p className="text-xs text-[#6b7685] leading-relaxed">
        A panel of interviewers shares the one tab track under this single Interviewer label —
        per-panellist controls aren't available yet.
      </p>

      {disabled && (
        <p className="text-xs text-[#6b7685] leading-relaxed">
          Locked while recording — the role is set for the whole session.
        </p>
      )}
    </div>
  );
};
