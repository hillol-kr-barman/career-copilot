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
    <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-[8px] shrink-0 border bg-amber-500/10 border-amber-500/20 text-amber-400">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold text-[#eef0f3]">Before you record</h3>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-[#9aa3b0] leading-relaxed">
          This tool records both people in this room — {SELF_SIDE[declaredSpeaker]} and{" "}
          {OTHER_SIDE[declaredSpeaker]} — through the one microphone on the table. Every person
          present must be told they're being recorded before you start, every time you start a
          new take.
        </p>
        <p className="text-sm text-[#9aa3b0] leading-relaxed">
          Recording-consent law differs by country and state; some places require everyone's
          agreement, not just yours. If you're not sure what applies to you, check before you
          record.
        </p>
        <p className="text-sm text-[#9aa3b0] leading-relaxed">
          Audio never leaves this browser. Nothing is uploaded, and nothing touches our servers.
        </p>
      </div>

      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id="consent-checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 shrink-0 w-4 h-4 accent-[#00d4dc] focus:outline-none focus:ring-1 focus:ring-[#00d4dc]"
        />
        <label htmlFor="consent-checkbox" className="text-sm text-[#9aa3b0] leading-relaxed">
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
          className="mt-0.5 shrink-0 w-4 h-4 accent-[#00d4dc] focus:outline-none focus:ring-1 focus:ring-[#00d4dc]"
        />
        <label htmlFor="keep-audio-checkbox" className="text-sm text-[#9aa3b0] leading-relaxed">
          Left unticked (the default), this take's audio recording — including{" "}
          {OTHER_SIDE[declaredSpeaker]}'s voice — is deleted as soon as the transcript is safely
          written; the transcript and the speaker tag track are always kept regardless. Tick this
          to keep the audio recording too.
        </label>
      </div>

      <button
        type="button"
        onClick={() => onAccept(keepAudioChecked)}
        disabled={!checked}
        className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-[#00d4dc]"
      >
        <span>Continue to recording setup</span>
      </button>
    </div>
  );
};
