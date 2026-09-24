import React, { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  /**
   * Shown on the closed header when the section holds a value. Without this a
   * collapsed override is invisible, and a user who set one has no way to tell
   * it is still in effect.
   */
  badge?: string | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Disclosure for secondary controls — the optional prompt overrides and the
 * interviewer ledger. These are advanced paths: showing them expanded competes
 * with the tool's primary action for attention, which is the thing most users
 * actually came to press.
 *
 * Drawn as a rule with a handle rather than a card. Nesting a bordered box
 * inside the sheet was what made the old page read as tiles inside tiles.
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  icon,
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="border-t border-rule">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="group flex w-full items-center gap-3 py-3.5 text-left"
      >
        <span className="shrink-0 text-ink-muted transition-colors group-hover:text-ink-soft">
          {icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-ink-soft transition-colors group-hover:text-ink">
              {title}
            </span>
            {badge && (
              <span className="max-w-[18rem] truncate rounded-[3px] bg-accent/10 px-1.5 py-0.5 font-mono text-sm text-accent">
                {badge}
              </span>
            )}
          </span>
          {subtitle && <span className="mt-0.5 block text-sm text-ink-muted">{subtitle}</span>}
        </span>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div id={panelId} className="pb-5 pt-1">
          {children}
        </div>
      )}
    </div>
  );
};
