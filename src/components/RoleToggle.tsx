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
      <span className="label">Your role in this interview</span>

      <div className="rounded-control border border-rule overflow-hidden inline-flex w-fit">
        <button
          type="button"
          aria-pressed={declaredSpeaker === "candidate"}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => onDeclaredSpeakerChange("candidate")}
          className={`px-4 py-2.5 text-[15px] transition-all disabled:opacity-50 ${
            declaredSpeaker === "candidate"
              ? "bg-solid text-solid-ink font-medium"
              : "bg-sunken text-ink-soft hover:text-ink"
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
          className={`px-4 py-2.5 text-[15px] transition-all disabled:opacity-50 ${
            declaredSpeaker === "interviewer"
              ? "bg-solid text-solid-ink font-medium"
              : "bg-sunken text-ink-soft hover:text-ink"
          }`}
        >
          I'm the interviewer
        </button>
      </div>

      <p className="text-[15px] text-ink-soft leading-relaxed measure">
        Set once, before you start. The spacebar marks who is speaking.
      </p>

      <p className="text-[15px] text-ink-muted leading-relaxed measure">
        A panel shares the one Interviewer side — per-panellist tagging isn't available yet.
      </p>

      {disabled && (
        <p className="text-[15px] text-ink-muted leading-relaxed measure">
          Locked while recording — set for the whole session.
        </p>
      )}
    </div>
  );
};
