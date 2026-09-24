import React, { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { Speaker } from "../types";

interface ConsentGateProps {
  onAccept: (keepAudio: boolean) => void;
  /** The operator's declared side (D-24) — lets the notice name both people
   * in the room concretely rather than describing a call. */
  declaredSpeaker: Speaker;
}

/** The other person in the room, from the operator's own declared side. */
const OTHER_SIDE: Record<Speaker, string> = {
  candidate: "the interviewer",
  interviewer: "the candidate",
};

/**
 * The operator's own side, named by role only. The tool serves candidates and
 * interviewers alike, so the notice names both people by what they are rather
 * than marking one of them as "you".
 */
const SELF_SIDE: Record<Speaker, string> = {
  candidate: "the candidate",
  interviewer: "the interviewer",
};

/**
 * Blocking inline panel — not a modal, per RESEARCH.md's explicit
 * recommendation. The app has never shipped a modal; this reuses the same
 * card-panel language `ToolSection`'s `lockedReason` branch already uses
 * ("you can't proceed yet, here's why, here's what to do"). It cannot live
 * inside `lockedReason` itself: that branch renders no children, which would
 * make the checkboxes unreachable.
 *
 * Two independent checkboxes, only one of which gates:
 * - **Consent** (required) — starts unchecked and is never pre-ticked, and
 *   Continue stays disabled until it is ticked. Consent is an affirmative
 *   act the operator takes, never a default the interface supplies.
 * - **Keep audio** (D-55, a choice, not a requirement) — starts unchecked
 *   and never blocks Continue. By default a take's audio is deleted once its
 *   transcript is safely written (the transcript and tag track are always
 *   kept); ticking this keeps the audio file too. This is the only moment
 *   the question is honest — the person whose voice would be kept is in the
 *   room, and the answer is settled before a single byte exists.
 *
 * Per D-34 this gate is mounted fresh for every take (the section unmounts
 * it rather than hiding it), so neither checkbox's state can ever carry from
 * one take to the next; there is no reset effect here because there is
 * nothing to reset. Adding persistence for either checkbox would be the
 * decay into "a default nobody remembers setting" that D-55 rejected.
 */
export const ConsentGate: React.FC<ConsentGateProps> = ({ onAccept, declaredSpeaker }) => {
  const [checked, setChecked] = useState(false);
  const [keepAudioChecked, setKeepAudioChecked] = useState(false);

  return (
    <div className="bg-sunken border border-rule rounded-control p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-control shrink-0 border bg-warn/10 border-warn/20 text-warn">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <h3 className="text-[15px] font-semibold text-ink">Before you record</h3>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          Everyone in the room must be told they're being recorded, before every take.
        </p>
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          Consent law varies — some places need everyone's agreement, not just yours. Check before
          recording.
        </p>
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          Audio never leaves this browser.
        </p>
      </div>

      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id="consent-checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 shrink-0 w-4 h-4 accent-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <label
          htmlFor="consent-checkbox"
          className="text-[15px] text-ink-soft leading-relaxed measure"
        >
          I've told everyone in this room they're being recorded, and I've checked that this is
          legal where I am.
        </label>
      </div>

      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id="keep-audio-checkbox"
          checked={keepAudioChecked}
          onChange={(e) => setKeepAudioChecked(e.target.checked)}
          className="mt-0.5 shrink-0 w-4 h-4 accent-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <label
          htmlFor="keep-audio-checkbox"
          className="text-[15px] text-ink-soft leading-relaxed measure"
        >
          Keep the audio too. Left unticked, the recording — including {OTHER_SIDE[declaredSpeaker]}
          's voice — is deleted once the transcript is safely written. The transcript and tag track
          are always kept.
        </label>
      </div>

      <button
        type="button"
        onClick={() => onAccept(keepAudioChecked)}
        disabled={!checked}
        className="w-full inline-flex items-center justify-center gap-2 rounded-control bg-solid px-5 py-2.5 text-[15px] font-medium text-solid-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <span>Continue to recording setup</span>
      </button>
    </div>
  );
};
