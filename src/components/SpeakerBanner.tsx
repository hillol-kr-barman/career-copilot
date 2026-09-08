import React from "react";
import { User, Briefcase } from "lucide-react";
import type { Speaker } from "../types";

export interface SpeakerBannerProps {
  /** Who the tag track currently attributes speech to. */
  speaker: Speaker;
  /** The operator's own declared side (D-24) — lets the band mark which side
   * is the operator's own. */
  declaredSpeaker: Speaker;
  /** Flips the current speaker. The spacebar shortcut itself is installed by
   * the section component (LiveInterview.tsx); this only wires the click/tap
   * path so the affordance works without a keyboard. */
  onFlip: () => void;
  /** True while paused — the band dims and says so, but keeps showing who
   * was marked when the take was paused rather than disappearing. */
  disabled: boolean;
}

/** The two display names, defined once and reused by the announcer, the
 * label, and any later consumer (LIVE-27). */
export const SPEAKER_LABEL: Record<Speaker, string> = {
  candidate: "Candidate",
  interviewer: "Interviewer",
};

const SPEAKER_ICON: Record<Speaker, React.ComponentType<{ className?: string }>> = {
  candidate: User,
  interviewer: Briefcase,
};

/**
 * Colour treatment per side (D-38): candidate takes the app's cyan accent
 * family, interviewer takes the amber family already used for warnings
 * elsewhere in this tool. Colour is reinforcement only — the name in text
 * and a distinct icon per side are what actually carry the distinction
 * (T-04-12-05), so the band still reads correctly under a grayscale filter.
 */
const SPEAKER_CLASSES: Record<Speaker, string> = {
  candidate: "bg-[rgba(0,212,220,0.1)] border-[rgba(0,212,220,0.3)] text-[#00d4dc]",
  interviewer: "bg-amber-500/10 border-amber-500/30 text-amber-400",
};

/**
 * The D-38 full-width current-speaker band: a large, high-contrast surface
 * across the tool section that is legible at a glance from a device lying
 * flat roughly a metre away, and changes the instant a spacebar press lands.
 * The whole band is a button so the flip also works by click or tap, for
 * anyone not at the keyboard or using assistive technology. Stays inside the
 * existing `ToolSection` chrome and the four approved font weights (D-20) —
 * no fifth weight is introduced here.
 */
export const SpeakerBanner: React.FC<SpeakerBannerProps> = ({
  speaker,
  declaredSpeaker,
  onFlip,
  disabled,
}) => {
  const Icon = SPEAKER_ICON[speaker];
  const isSelf = speaker === declaredSpeaker;

  return (
    <button
      type="button"
      onClick={onFlip}
      disabled={disabled}
      aria-label={`Now speaking: ${SPEAKER_LABEL[speaker]}${
        isSelf ? " (you)" : ""
      }. Press to mark the other side as speaking instead.`}
      className={`w-full flex flex-col items-center gap-1.5 rounded-[8px] border py-5 px-4 transition-all active:scale-[0.99] disabled:opacity-50 ${SPEAKER_CLASSES[speaker]}`}
    >
      <span className="flex items-center gap-2.5">
        <Icon className="w-7 h-7 shrink-0" aria-hidden="true" />
        <span className="text-2xl font-extrabold tracking-tight">
          {SPEAKER_LABEL[speaker]}
          {isSelf && <span className="text-sm font-semibold opacity-70 ml-1.5">(you)</span>}
        </span>
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wider opacity-70">
        {disabled ? "Paused — this is who was marked" : "Now speaking — press Space or tap to flip"}
      </span>
    </button>
  );
};
