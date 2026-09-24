import React from "react";
import { Lock } from "lucide-react";

interface ToolSectionProps {
  id: string;
  /** Position in the sequence, rendered as the margin label's number. */
  step: string;
  /**
   * The margin label's name — the *kind* of work this step is, not its title.
   * Setting it to the title would print the heading twice, once in the margin
   * and once beneath it.
   */
  phase: string;
  title: string;
  subtitle: string;
  /** Reason this tool can't run yet. When set, a note replaces the controls. */
  lockedReason?: string | null;
  children: React.ReactNode;
}

/**
 * Chrome for a single tool.
 *
 * The two-column arrangement is the reference's signature: a mono, tracked,
 * uppercase "NN — NAME" label out in the left margin, with the real heading and
 * the content in the main column. The label names the stage of work and the
 * heading names the tool, the way the reference pairs "02 — FEATURED PROJECTS"
 * with an individual project's name.
 *
 * There is deliberately no card around this: only one tool is on screen at a
 * time, so the panel itself is the surface.
 */
export const ToolSection: React.FC<ToolSectionProps> = ({
  id,
  step,
  phase,
  title,
  subtitle,
  lockedReason,
  children,
}) => (
  <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-8">
    <header className="relative">
      {/* The chapter mark: the figure set large enough to be a landmark you
          can find while scrolling, with the stage of work beneath it. Stacked
          rather than run inline, so the number reads as a position and the
          name as a caption for it. */}
      <div
        aria-hidden="true"
        className="mb-5 flex items-baseline gap-3 md:absolute md:-left-40 md:top-1 md:mb-0 md:w-32 md:flex-col md:items-start md:gap-1"
      >
        <span className="tnum font-mono text-[26px] font-medium leading-none text-accent">
          {step}
        </span>
        <span className="label">{phase}</span>
      </div>

      <h2 id={`${id}-title`} className="display text-[30px] md:text-[38px]">
        {title}
      </h2>
      <p className="measure mt-3 text-[15px] leading-relaxed text-ink-soft">{subtitle}</p>
    </header>

    {lockedReason ? (
      // A locked tool is a note, not an error: nothing has gone wrong, there is
      // simply a step still to do.
      <p className="measure flex items-start gap-2.5 rounded-control border border-rule bg-sunken px-4 py-3.5 text-[15px] text-ink-soft">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <span>{lockedReason}</span>
      </p>
    ) : (
      <div className="flex flex-col gap-6">{children}</div>
    )}
  </section>
);
