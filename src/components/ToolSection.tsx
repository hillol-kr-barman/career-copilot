import React from "react";
import { Lock } from "lucide-react";

interface ToolSectionProps {
  id: string;
  step: string;
  title: string;
  subtitle: string;
  /** Reason this tool can't run yet. When set, the body is dimmed and a hint replaces the controls. */
  lockedReason?: string | null;
  children: React.ReactNode;
}

/** Consistent chrome for each of the three tools on the page. */
export const ToolSection: React.FC<ToolSectionProps> = ({
  id,
  step,
  title,
  subtitle,
  lockedReason,
  children,
}) => {
  const locked = Boolean(lockedReason);

  return (
    <section
      id={id}
      className="w-full scroll-mt-6 rounded-[10px] bg-[#161a1e] border border-[rgba(255,255,255,0.07)] p-5 md:p-7 flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(255,255,255,0.07)] pb-4">
        <div className="flex items-center gap-2.5">
          <span className="px-2.5 py-0.5 text-[9px] md:text-xs font-semibold tracking-wider uppercase rounded-[4px] border text-[#00d4dc] bg-[rgba(0,212,220,0.08)] border-[rgba(0,212,220,0.2)] shrink-0">
            {step}
          </span>
          <div>
            <h2 className="text-base md:text-lg font-medium tracking-tight text-[#eef0f3]">{title}</h2>
            <p className="text-xs text-[#6b7685] mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>

      {locked ? (
        <div className="flex items-center gap-2.5 text-xs text-[#6b7685] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] px-4 py-4">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>{lockedReason}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-5">{children}</div>
      )}
    </section>
  );
};
