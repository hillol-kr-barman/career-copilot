import React from "react";
import { LogoMark } from "./LogoMark";

/**
 * The mark plus the name.
 *
 * The mark carries the accent — it is the one place on the page where the
 * accent appears without also meaning "interactive", which is what makes it
 * read as identity rather than as a control.
 */
export const Wordmark: React.FC<{ className?: string }> = ({ className = "" }) => (
  <span className={`flex items-center gap-2.5 ${className}`}>
    <LogoMark className="h-6 w-7 shrink-0 text-accent" />
    <span className="text-[15px] font-semibold tracking-tight text-ink">Career Copilot</span>
  </span>
);
