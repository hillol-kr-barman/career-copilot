import React from "react";
import { BadgeCheck, Check } from "lucide-react";
import { LogoMark } from "./LogoMark";

/**
 * The hero's side image: the four tools as a stack of their own output, on the
 * accent panel that used to sit behind the whole hero.
 *
 * Built in markup rather than shipped as a picture. A screenshot would be a
 * fixed set of pixels in one theme at one width — it would have to be retaken
 * every time a tool's layout moved, and it would sit as a light slab in the
 * dark theme, which is the one most people land on. Built from the same tokens
 * as the rest of the app, it follows the theme and the type for free.
 *
 * The figures are illustrative, not a real result, so the whole thing is
 * aria-hidden: a screen reader announcing "74% callback likelihood" in the hero
 * would be reading out a number that belongs to nobody. The headline and the
 * copy beside it already say what the tool does.
 *
 * Step numbers match the rail — the four tools are 02 to 05, because 01 is the
 * intake and has no result to show.
 */

/** One of the three cards standing behind the focused one. */
const QuietCard: React.FC<{ step: string; name: string; children: React.ReactNode }> = ({
  step,
  name,
  children,
}) => (
  // Held back rather than hidden. At full strength four cards compete and the
  // eye has nowhere to land; recessed, they read as the rest of the run with
  // one result pulled to the front.
  //
  // Faded in the type and the border, not with `opacity` on the card. A
  // translucent card lets the mark behind it through, and the logo showing
  // faintly through three of the four cards read as a printing fault rather
  // than as depth.
  <div className="rounded-control border border-rule/60 bg-surface px-4 py-3">
    <p className="flex items-baseline gap-2 opacity-60">
      <span className="tnum font-mono text-[12px] font-medium text-accent">{step}</span>
      <span className="label">{name}</span>
    </p>
    <div className="mt-1.5 text-[13px] leading-snug text-ink-muted">{children}</div>
  </div>
);

export const HeroPreview: React.FC = () => (
  // The colour and the padding are separate boxes on purpose. The ground has to
  // run off the right edge of the window while the cards stay inside the page's
  // container, and one box cannot do both — `overflow-hidden`, which the mark
  // needs, would clip the bleed at the same edge it is supposed to cross.
  <div aria-hidden="true" className="relative select-none">
    {/* Rounded on the left, square on the right, because the right edge is not
        an edge — it is the window cutting the panel off. A radius there would
        claim the panel ends where the screen does. */}
    <div className="band-panel band-bleed-right absolute inset-y-0 left-0 overflow-hidden rounded-l-card">
      {/* Enters from the top right and runs off both of those edges. Rotated
          off-axis so the crop reads as artwork the frame happens to cut rather
          than as a badge someone centred and then trimmed. */}
      <LogoMark className="band-mark absolute -top-[1%] -right-[5%] h-auto w-[99%] rotate-[-30deg] text-accent" />
    </div>

    {/* Straight, flush, no tilt: these are meant to read as a run of steps in
        order, and a tilt turns an ordered list into a scattered pile. */}
    <div className="relative flex flex-col gap-2.5 p-10">
      <QuietCard step="02" name="AI check">
        <span className="inline-flex items-center gap-1.5 font-medium text-good">
          <Check className="h-3.5 w-3.5 shrink-0" />
          Reads as human-written
        </span>
      </QuietCard>

      <QuietCard step="03" name="Resume audit">
        <span className="flex items-baseline justify-between gap-3">
          Callback likelihood
          <span className="tnum font-mono font-semibold text-ink">90%</span>
        </span>
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-sunken">
          <span className="block h-full w-[90%] rounded-full bg-accent" />
        </span>
      </QuietCard>

      <QuietCard step="04" name="Interview prep">
        Eight questions, each with an answer in your own voice
      </QuietCard>

      {/* The focused one. Full strength, a heavier ground and an accent edge —
          three signals rather than one, so it still reads as the front of the
          stack for anyone who cannot separate the two opacities. */}
      <div className="rounded-control border border-accent-edge bg-surface p-4 shadow-card">
        <p className="flex items-baseline gap-2">
          <span className="tnum font-mono text-[13px] font-medium text-accent">05</span>
          <span className="label">Live interview</span>
        </p>

        {/* What the feedback document opens with, because it is the part no
            other tool surfaces. */}
        <p className="label mt-4">Went unanswered</p>
        <p className="display mt-1 text-[28px] leading-none">2 of 9</p>

        <div className="mt-4 flex flex-col gap-2 border-t border-rule pt-3.5">
          <p className="flex items-start gap-2 text-[13px] leading-snug text-ink-soft">
            <span className="mt-px shrink-0 rounded-[6px] bg-mark-wash px-1.5 font-mono text-[10px] font-semibold tracking-wide text-mark">
              NOT ADDRESSED
            </span>
            Scaling beyond the first ten thousand users
          </p>
          <p className="flex items-start gap-2 text-[13px] leading-snug text-ink-soft">
            <span className="mt-px shrink-0 rounded-[6px] bg-warn-wash px-1.5 font-mono text-[10px] font-semibold tracking-wide text-warn">
              PARTIAL
            </span>
            Trade-offs weighed during the migration
          </p>
        </div>

        <p className="mt-4 flex items-center gap-2 rounded-control bg-sunken px-3 py-2 font-mono text-[11px] text-ink-muted">
          <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
          Quote located in transcript
        </p>
      </div>
    </div>
  </div>
);
