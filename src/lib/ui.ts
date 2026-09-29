/**
 * Shared control classes.
 *
 * `.cta` (defined in index.css) carries the colour and the arrow motion; these
 * constants carry the box. Keeping them here means the hero's action and the
 * step-to-step pagination are literally the same button rather than two that
 * happen to look alike — the pagination had drifted into a grey-and-black
 * treatment that appeared nowhere else in the app.
 */
export const CTA =
  "cta inline-flex items-center gap-3 rounded-control px-5 py-2.5 text-[15px] font-medium";

/** The quieter partner: a text action with no box, for back/secondary moves. */
export const CTA_QUIET =
  "cta-quiet inline-flex items-center gap-2 rounded-control px-1 py-2 text-[15px] font-medium";
