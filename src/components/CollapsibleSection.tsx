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
    <div className="rounded-[8px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128]/40">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-center gap-2.5 text-left p-3.5 group rounded-[8px] hover:bg-[rgba(255,255,255,0.02)] transition-colors"
      >
        <span className="p-1.5 rounded-[6px] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] text-[#6b7685] group-hover:text-[#9aa3b0] transition-colors shrink-0">
          {icon}
        </span>

        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[#9aa3b0] group-hover:text-[#eef0f3] transition-colors">
              {title}
            </span>
            {badge && (
              <span className="text-[10px] font-mono text-[#00d4dc] bg-[rgba(0,212,220,0.08)] border border-[rgba(0,212,220,0.25)] rounded-[4px] px-1.5 py-0.5 truncate max-w-[16rem]">
                {badge}
              </span>
            )}
          </span>
          {subtitle && (
            <span className="block text-[11px] text-[#6b7685] mt-0.5">{subtitle}</span>
          )}
        </span>

        <ChevronDown
          className={`w-4 h-4 text-[#6b7685] shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div id={panelId} className="px-3.5 pb-3.5 pt-1">
          {children}
        </div>
      )}
    </div>
  );
};
