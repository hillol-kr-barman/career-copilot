import React from "react";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { Step } from "./StepRail";
import { CTA, CTA_QUIET } from "../lib/ui";

interface StepFooterProps {
  steps: Step[];
  currentId: string;
  onSelect: (id: string) => void;
}

const stepNumber = (index: number) => String(index + 1).padStart(2, "0");

/**
 * What to do when this step is done.
 *
 * The rail alone showed where you were but never where to go, so finishing a
 * step left you to work out the next move yourself — you could run the AI check
 * and get no sense that an audit was the point of doing it. This closes each
 * step with the next one named.
 *
 * A blocked next step is still pressable, matching the rail: the reason is
 * printed beside it so you know what is missing before you go, rather than
 * meeting a dead control that refuses to explain itself.
 */
export const StepFooter: React.FC<StepFooterProps> = ({ steps, currentId, onSelect }) => {
  const index = steps.findIndex((s) => s.id === currentId);
  if (index === -1) return null;

  const previous = index > 0 ? steps[index - 1] : null;
  const next = index < steps.length - 1 ? steps[index + 1] : null;

  return (
    <nav
      aria-label="Step navigation"
      className="mt-16 flex flex-col-reverse gap-6 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between"
    >
      {previous ? (
        <button
          type="button"
          onClick={() => onSelect(previous.id)}
          className={`${CTA_QUIET} self-start`}
        >
          <ArrowLeft className="cta-arrow-back h-4 w-4" />
          <span className="tnum font-mono text-xs text-ink-muted">{stepNumber(index - 1)}</span>
          {previous.label}
        </button>
      ) : (
        // Keeps the next-step control hard right on the first step too.
        <span aria-hidden="true" />
      )}

      {next ? (
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {next.lockedReason && (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              {next.lockedReason}
            </p>
          )}
          <button type="button" onClick={() => onSelect(next.id)} className={CTA}>
            <span className="tnum font-mono text-xs opacity-70">{stepNumber(index + 1)}</span>
            {next.label}
            <ArrowRight className="cta-arrow h-4 w-4" />
          </button>
        </div>
      ) : (
        <p className="text-[15px] text-ink-muted sm:text-right">
          That is every step — you are ready for the interview.
        </p>
      )}
    </nav>
  );
};
