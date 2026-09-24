import React from "react";
import { MessagesSquare } from "lucide-react";
import type { Coverage, Exchange, SubAsk } from "../types";
import { CollapsibleSection } from "./CollapsibleSection";
import { RenderMarkdown } from "../lib/renderMarkdown";
import { formatElapsed } from "../lib/formatTime";
import { deriveScoreRow } from "../lib/feedbackRollups";

export interface ExchangeDetailProps {
  exchange: Exchange;
  /** Reports the clicked sub-ask's resolved segment upward. The jump rule
   * itself lives in `LiveInterview.tsx`, never here — this component only
   * ever reports what was clicked, the same split `TranscriptTurnRow`'s
   * `onMoveBoundary` already follows for D-50. */
  onJumpToSegment: (seq: number) => void;
  /** D-51's condition, mirrored: true only once a take is stopped and has a
   * transcript — a click on a still-recording, still-appending transcript
   * is meaningless (D-60). */
  canJump: boolean;
}

const COVERAGE_ORDER: Coverage[] = ["ADDRESSED", "PARTIAL", "NOT_ADDRESSED", "DEFLECTED"];

/**
 * D-59's glyph-to-verdict mapping, defined once here so the closed-header
 * coverage strip (`coverageStrip`) and the expanded card body's per-sub-ask
 * rows can never disagree about what a glyph means.
 */
export const COVERAGE_META: Record<Coverage, { glyph: string; label: string }> = {
  ADDRESSED: { glyph: "●", label: "addressed" },
  PARTIAL: { glyph: "◐", label: "partial" },
  NOT_ADDRESSED: { glyph: "○", label: "not addressed" },
  DEFLECTED: { glyph: "◒", label: "deflected" },
};

const capitalize = (word: string): string => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1));

/**
 * D-59's closed-header summary: a run of per-sub-ask glyphs, then a counted,
 * worded breakdown ordered ADDRESSED -> PARTIAL -> NOT_ADDRESSED -> DEFLECTED.
 * Neither half stands alone as the identifier — the glyph run distinguishes
 * shape and the breakdown spells out the words the glyphs cannot say on
 * their own; the four shapes are not self-describing, so colour is never
 * what carries the distinction (D-59).
 */
export function coverageStrip(subAsks: SubAsk[]): string {
  const list = Array.isArray(subAsks) ? subAsks : [];
  if (list.length === 0) return "No sub-asks";

  const glyphRun = list.map((subAsk) => COVERAGE_META[subAsk.coverage]?.glyph ?? "○").join("");

  const counts = new Map<Coverage, number>();
  for (const subAsk of list) {
    counts.set(subAsk.coverage, (counts.get(subAsk.coverage) ?? 0) + 1);
  }
  const breakdown = COVERAGE_ORDER.filter((coverage) => (counts.get(coverage) ?? 0) > 0)
    .map((coverage) => `${counts.get(coverage)} ${COVERAGE_META[coverage].label}`)
    .join(" · ");

  return breakdown ? `${glyphRun}  ${breakdown}` : glyphRun;
}

/**
 * D-59's per-exchange collapsed card: `CollapsibleSection` is used
 * unmodified — its existing `subtitle` prop already carries the closed-header
 * coverage strip this component builds, so no change to that component is
 * needed. Expanding the card reveals every sub-ask with its own verdict,
 * never one verdict for the whole exchange (LIVE-15), and — last — the D-73
 * STAR completeness read, rendered only when `starApplicable` is true AND
 * `deriveScoreRow` actually returned a row. A STAR grade against a rubric
 * that never applied would be worse than no read at all, so a `null` here
 * renders nothing: not a zero, not a placeholder.
 */
export const ExchangeDetail: React.FC<ExchangeDetailProps> = ({ exchange, onJumpToSegment, canJump }) => {
  const scoreRow = exchange.starApplicable ? deriveScoreRow(exchange.questionText, exchange.scoreRow) : null;

  return (
    <CollapsibleSection
      icon={<MessagesSquare className="w-3.5 h-3.5" />}
      title={exchange.questionText}
      subtitle={coverageStrip(exchange.subAsks)}
      defaultOpen={false}
    >
      <div className="flex flex-col gap-3">
        {exchange.questionIntent && (
          <div className="text-[11px] text-[#6b7685] italic leading-relaxed">
            <RenderMarkdown text={exchange.questionIntent} />
          </div>
        )}

        <ul className="flex flex-col gap-2.5">
          {exchange.subAsks.map((subAsk, i) => (
            <SubAskRow key={i} subAsk={subAsk} onJumpToSegment={onJumpToSegment} canJump={canJump} />
          ))}
        </ul>

        {scoreRow && (
          <div className="flex flex-col gap-2 border-t border-[rgba(255,255,255,0.05)] pt-3">
            <h5 className="text-xs font-semibold text-[#eef0f3]">STAR completeness</h5>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <ScoreField label="Situation" value={scoreRow.s} />
              <ScoreField label="Task" value={scoreRow.tE} />
              <ScoreField label="Action" value={scoreRow.a} />
              <ScoreField label="Result" value={scoreRow.rT} />
            </div>
            <p className="text-[11px] text-[#6b7685]">
              STAR rating: <span className="font-mono text-[#00d4dc]">{scoreRow.starRating}</span>
            </p>
            {exchange.starNote && (
              <div className="text-xs text-[#9aa3b0] leading-relaxed">
                <RenderMarkdown text={exchange.starNote} />
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

const ScoreField: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] uppercase tracking-wider text-[#6b7685]">{label}</span>
    <span className="font-mono text-[#eef0f3]">{value}</span>
  </div>
);

interface SubAskRowProps {
  subAsk: SubAsk;
  onJumpToSegment: (seq: number) => void;
  canJump: boolean;
}

/**
 * One sub-ask row inside the expanded exchange card: its own verdict (glyph
 * plus word, never colour alone), a visible `implied_by_jd` label framed as
 * an opportunity the job description implies rather than a question that
 * was dodged (D-65), the model's assessment and what a good answer would
 * have included, and its evidence.
 *
 * Evidence follows D-60/D-66's three states: a verified quote with a
 * resolved segment renders as a real, keyboard-reachable
 * `<button type="button">` once a take is stopped (`canJump`), copying
 * `TranscriptTurnRow`'s own button treatment (`title`, `focus-visible`
 * outline); the same quote renders as plain, non-interactive text while
 * recording — matching `TranscriptView`'s own canCorrect-false rendering,
 * an unusable control being noise rather than an affordance; an unverified
 * quote renders no time reference and no control at all, stating plainly
 * that no quotable evidence was found — D-66's downgrade made visible
 * rather than a silently weaker verdict.
 */
const SubAskRow: React.FC<SubAskRowProps> = ({ subAsk, onJumpToSegment, canJump }) => {
  const meta = COVERAGE_META[subAsk.coverage];
  const hasVerifiedEvidence =
    subAsk.evidenceQuote.trim().length > 0 && !subAsk.quoteUnverified && subAsk.evidenceSegmentSeq !== undefined;

  return (
    <li className="flex flex-col gap-1.5 border-t border-[rgba(255,255,255,0.05)] pt-2.5 first:border-t-0 first:pt-0">
      <span className="flex items-start gap-2 text-xs flex-wrap">
        <span className="text-[#00d4dc] font-mono shrink-0">{meta.glyph}</span>
        <span className="font-semibold text-[#eef0f3]">{capitalize(meta.label)}</span>
        {subAsk.source === "implied_by_jd" && (
          <span className="text-[9px] font-mono font-semibold uppercase tracking-wider text-[#6b7685] border border-[rgba(255,255,255,0.07)] rounded-[4px] px-1.5 py-0.5">
            An opportunity the job description implies
          </span>
        )}
      </span>

      <span className="text-sm text-white/80 leading-relaxed pl-5">{subAsk.text}</span>

      {subAsk.assessment && (
        <div className="pl-5 text-xs text-[#9aa3b0] leading-relaxed">
          <RenderMarkdown text={subAsk.assessment} />
        </div>
      )}

      {subAsk.whatAGoodAnswerWouldHaveIncluded && (
        <div className="pl-5 text-xs text-[#6b7685] leading-relaxed">
          <span className="font-semibold text-[#9aa3b0]">A good answer would have included: </span>
          <RenderMarkdown text={subAsk.whatAGoodAnswerWouldHaveIncluded} />
        </div>
      )}

      {hasVerifiedEvidence ? (
        canJump ? (
          <button
            type="button"
            onClick={() => onJumpToSegment(subAsk.evidenceSegmentSeq as number)}
            title="Jump to this line in the transcript"
            className="text-left text-xs text-[#9aa3b0] italic leading-relaxed pl-5 rounded-[4px] -ml-1 pr-1 transition-colors hover:bg-[rgba(0,212,220,0.08)] hover:text-[#eef0f3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00d4dc]"
          >
            <span className="font-mono text-[#00d4dc] not-italic">[{formatElapsed(subAsk.evidenceStartMs ?? 0)}]</span>{" "}
            "{subAsk.evidenceQuote}"
          </button>
        ) : (
          <span className="text-xs text-[#9aa3b0] italic leading-relaxed pl-5">
            <span className="font-mono text-[#00d4dc] not-italic">[{formatElapsed(subAsk.evidenceStartMs ?? 0)}]</span>{" "}
            "{subAsk.evidenceQuote}"
          </span>
        )
      ) : subAsk.quoteUnverified ? (
        <span className="text-[11px] text-amber-500 pl-5">
          No quotable evidence for this was found in the transcript.
        </span>
      ) : null}
    </li>
  );
};
