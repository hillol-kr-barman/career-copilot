import React from "react";
import { Theme } from "../lib/theme";

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

/**
 * Sun and moon as one shape rather than two icons swapped out.
 *
 * The disc never leaves; what changes around it is:
 *  - the eight rays retract into the disc and fade as dark comes on,
 *  - a second disc — punched out of the first through a mask — slides in from
 *    the top right to bite the crescent out of it,
 *  - the whole glyph counter-rotates, so the change reads as one movement.
 *
 * Doing it with a mask rather than by cross-fading a sun PNG and a moon PNG is
 * what lets the crescent be carved from the same circle the sun was, which is
 * the part that makes it feel like one object instead of two.
 *
 * `useId` keeps the mask id unique — two toggles on a page sharing one id would
 * make the second silently reuse the first's mask.
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onToggle }) => {
  const maskId = React.useId();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={onToggle}
      className="theme-toggle rounded-control border border-rule p-2 text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark}
      data-theme-state={dark ? "dark" : "light"}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <mask id={maskId}>
          {/* White keeps, black removes. The travelling disc is what carves
              the crescent out of the sun. */}
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <circle className="tt-bite" cx="24" cy="10" r="6" fill="black" />
        </mask>

        <circle
          className="tt-disc"
          cx="12"
          cy="12"
          r="5"
          fill="currentColor"
          mask={`url(#${maskId})`}
        />

        <g className="tt-rays" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="12" y1="1.6" x2="12" y2="3.6" />
          <line x1="12" y1="20.4" x2="12" y2="22.4" />
          <line x1="1.6" y1="12" x2="3.6" y2="12" />
          <line x1="20.4" y1="12" x2="22.4" y2="12" />
          <line x1="4.6" y1="4.6" x2="6.1" y2="6.1" />
          <line x1="17.9" y1="17.9" x2="19.4" y2="19.4" />
          <line x1="4.6" y1="19.4" x2="6.1" y2="17.9" />
          <line x1="17.9" y1="6.1" x2="19.4" y2="4.6" />
        </g>
      </svg>
    </button>
  );
};
