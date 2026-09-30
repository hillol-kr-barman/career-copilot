import React from "react";
import { LogoMark } from "./LogoMark";

/**
 * A solid band of colour running the full width of the window, with the logo
 * blown up and cropped against its right edge.
 *
 * The footer is the only one left. The hero used to open the page with a
 * matching band; its colour moved onto the preview panel instead, which keeps
 * the accent tied to the thing it illustrates. The .band-panel and .band-mark
 * classes are still shared by both, so the two stay the same colour.
 *
 * The band is deliberately full-bleed rather than container-width. A coloured
 * block that stops at the text's own margins reads as a card someone forgot to
 * put a border on; one that runs off both edges reads as the page changing
 * colour, which is the point. Cropping the mark at the window edge is the same
 * decision — it is meant to run off, not to sit inside a frame.
 *
 * Colour is mixed from `--accent` against `--ground`, so one file serves both
 * themes: a pale violet panel over near-white, a violet-cast slate over
 * near-black. Strength is set in index.css, where the dark theme takes its own
 * values — a mix tuned against white is invisible against black.
 *
 * The caller places it in a `relative isolate` box. `isolate` is what keeps the
 * negative layer inside that box rather than sliding behind the page ground.
 */
const Band: React.FC<{ panelClassName?: string; children: React.ReactNode }> = ({
  panelClassName = "",
  children,
}) => (
  // w-screen with a centring translate breaks the band out of its container.
  // 100vw counts the scrollbar the page always shows, so the band overhangs
  // each side by half a scrollbar; `overflow-x-clip` on the page root absorbs
  // that without turning into a horizontal scrollbar. `clip` rather than
  // `hidden` because hidden would make the root a scroll container and strand
  // the sticky masthead.
  <div
    className={`band-panel pointer-events-none absolute left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden ${panelClassName}`}
    aria-hidden="true"
  >
    {children}
  </div>
);

/**
 * The footer's band.
 *
 * The mark falls off the bottom as well as the right, which suits the end of
 * the page.
 */
export const FooterBand: React.FC = () => (
  <Band panelClassName="inset-y-0">
    <LogoMark className="band-mark absolute -bottom-[38%] right-0 h-auto w-[min(52vw,400px)] translate-x-[14%] rotate-[9deg] text-accent" />
  </Band>
);
