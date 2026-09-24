import React from "react";
import { Lock } from "lucide-react";

export interface Step {
  id: string;
  label: string;
  /** Set when the step can't run yet; the tab stays reachable so the reason is readable. */
  lockedReason?: string | null;
}

interface StepRailProps {
  steps: Step[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * The four tools, as an index rather than a row of SaaS tabs.
 *
 * A locked step is never disabled — pressing it shows the sentence explaining
 * what is still missing, which is the thing the person actually needs. A
 * disabled control that refuses to say why is the worse failure.
 */
export const StepRail: React.FC<StepRailProps> = ({ steps, activeId, onSelect }) => {
  // Roving arrow-key navigation, per the tablist pattern.
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + steps.length) % steps.length;
    onSelect(steps[next].id);
    document.getElementById(`steptab-${steps[next].id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Tools"
      className="no-scrollbar -mx-6 flex items-stretch gap-1 overflow-x-auto border-b border-rule px-6 md:mx-0 md:px-0"
    >
      {steps.map((step, i) => {
        const active = step.id === activeId;
        const locked = Boolean(step.lockedReason);

        return (
          <button
            key={step.id}
            id={`steptab-${step.id}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`steppanel-${step.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(step.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`group relative -mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-3.5 transition-colors ${
              active
                ? "border-accent text-ink"
                : "border-transparent text-ink-soft hover:border-rule-strong hover:text-ink"
            }`}
          >
            {/* The index is mono because it is data about position, not a
                label — the same voice as the section labels in the margin. */}
            <span className={`tnum font-mono text-xs ${active ? "text-accent" : "text-ink-muted"}`}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className={`whitespace-nowrap text-[15px] ${active ? "font-medium" : ""}`}>
              {step.label}
            </span>
            {locked && <Lock className="h-3.5 w-3.5 text-ink-muted" aria-label="not ready yet" />}
          </button>
        );
      })}
    </div>
  );
};
