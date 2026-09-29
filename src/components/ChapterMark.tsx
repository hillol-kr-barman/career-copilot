import React from "react";

interface ChapterMarkProps {
  /** Position in the sequence, e.g. "01". */
  step: string;
  /** The stage of work — a caption for the figure, not a repeat of the heading. */
  phase: string;
}

/**
 * The step's number and stage, sitting directly above its heading.
 *
 * This used to hang in a left margin column, which cost 176px of page width on
 * every screen, put the figure far from the heading it belongs to, and
 * collapsed to something different on mobile. Inline above the heading it reads
 * as a single unit with the title, needs no reserved gutter, and behaves the
 * same at every width.
 *
 * Decorative to assistive tech: the heading beneath already names the section
 * and the step rail already announces position, so reading "01 Intake" aloud
 * before every heading would just be noise.
 */
export const ChapterMark: React.FC<ChapterMarkProps> = ({ step, phase }) => (
  <p aria-hidden="true" className="mb-3 flex items-baseline gap-2.5">
    <span className="tnum font-mono text-[15px] font-medium leading-none text-accent">{step}</span>
    <span className="label">{phase}</span>
  </p>
);
