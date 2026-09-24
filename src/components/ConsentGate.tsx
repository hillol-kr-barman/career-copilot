import React, { useState } from "react";
import { ShieldAlert } from "lucide-react";

interface ConsentGateProps {
  onAccept: (keepAudio: boolean) => void;
}

/**
 * Blocking inline panel — not a modal, per RESEARCH.md's explicit
 * recommendation. The app has never shipped a modal; this reuses the same
 * card-panel language `ToolSection`'s `lockedReason` branch already uses. It
 * cannot live inside `lockedReason` itself: that branch renders no children,
 * which would make the checkboxes unreachable.
 *
 * The notice is deliberately one line. The full disclosure sits behind the
 * expander below rather than on a separate page: this gate stands between the
 * operator and a recording they are about to start, and sending them away
 * mid-setup to read a policy is how consent flows get skipped. Everything the
 * short notice compresses is still one click away, in the same place, without
 * losing the recording setup behind it.
 *
 * Two independent checkboxes, only one of which gates:
 * - **Consent** (required) — starts unchecked and is never pre-ticked, and
 *   Continue stays disabled until it is ticked. Consent is an affirmative act
 *   the operator takes, never a default the interface supplies.
 * - **Keep audio** (D-55, a choice, not a requirement) — starts unchecked and
 *   never blocks Continue. By default a take's audio is deleted once its
 *   transcript is safely written; ticking this keeps the audio file too. This
 *   is the only moment the question is honest — the person whose voice would
 *   be kept is in the room, and the answer is settled before a byte exists.
 *
 * Per D-34 this gate is mounted fresh for every take (the section unmounts it
 * rather than hiding it), so neither checkbox's state can carry from one take
 * to the next; there is no reset effect here because there is nothing to
 * reset. Adding persistence for either would be the decay into "a default
 * nobody remembers setting" that D-55 rejected.
 */
export const ConsentGate: React.FC<ConsentGateProps> = ({ onAccept }) => {
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

      <p className="text-[15px] text-ink-soft leading-relaxed measure">
        Tell everyone in the room they're being recorded. Audio never leaves this browser.
      </p>

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
          Everyone here knows they're being recorded, and it's legal where I am.
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
          Keep the audio too — otherwise it's deleted once the transcript is written.
        </label>
      </div>

      {/* Native <details> rather than a controlled disclosure: it is keyboard
          operable and findable by in-page search even while collapsed, which a
          div toggled by state is not. */}
      <details className="group">
        <summary className="cursor-pointer text-[15px] text-ink-muted underline decoration-rule underline-offset-4 transition-colors hover:text-ink-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
          What this records, keeps and deletes
        </summary>

        <div className="mt-3 flex flex-col gap-2.5 border-l border-rule pl-4 text-[15px] leading-relaxed text-ink-muted measure">
          <p>
            <strong className="font-semibold text-ink-soft">Consent.</strong> Consent law varies —
            some places need everyone's agreement, not just yours. Check before recording. This
            notice is re-asked before every take.
          </p>
          <p>
            <strong className="font-semibold text-ink-soft">Where it goes.</strong> One microphone
            records both people. The audio is never uploaded — transcription runs on your machine,
            in this browser, and the recording is held in this browser's own storage. No server
            receives it.
          </p>
          <p>
            <strong className="font-semibold text-ink-soft">What is kept.</strong> The transcript
            and the tag track of who spoke when are always kept. The audio file is deleted once the
            transcript is safely written, unless you tick keep-audio above. A take whose transcript
            is only partial keeps its audio regardless, so nothing is lost.
          </p>
          <p>
            <strong className="font-semibold text-ink-soft">Deleting it.</strong> Every take has its
            own delete control, and "Clear stored data" at the foot of the page removes every take,
            transcript, feedback document and saved input this browser holds.
          </p>
          <p>
            <strong className="font-semibold text-ink-soft">The feedback document.</strong> If you
            generate one, the transcript text is sent to whichever AI provider owns the key you
            entered — that step, and only that step, leaves your machine. It judges what was said,
            never how it was said.
          </p>
        </div>
      </details>

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
