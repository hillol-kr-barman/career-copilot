import React from "react";

/**
 * Minimal markdown rendering for model output.
 *
 * The prompts ask for plain text with section markers, but models reliably
 * emit `**bold**` and `* bullet` anyway. Rendering their output as raw text
 * leaves the asterisks visible, so this handles the two cases that actually
 * show up — emphasis and bullets — and nothing else. It builds React nodes
 * rather than injecting HTML, so model output can never become markup.
 */

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;

const renderInline = (text: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    if (match[1] !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold text-[#eef0f3]">
          {match[1]}
        </strong>
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <em key={key++} className="italic">
          {match[2]}
        </em>
      );
    } else {
      nodes.push(
        <code key={key++} className="font-mono text-[11px] text-[#00d4dc]">
          {match[3]}
        </code>
      );
    }
    lastIndex = INLINE.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

export const RenderMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-sm text-white/80 leading-relaxed font-sans flex flex-col">
    {text.split("\n").map((line, i) => {
      if (!line.trim()) return <div key={i} className="h-3" />;

      const isBullet = /^\s*[*-]\s+/.test(line);
      const isNumbered = /^\s*\d+\.\s+/.test(line);
      // Nested detail lines (the "Fix:" under a "Where:") arrive indented.
      const isIndented = /^\s{2,}/.test(line) && !isBullet;
      const body = isBullet ? line.replace(/^\s*[*-]\s+/, "") : line.trim();

      return (
        <div
          key={i}
          className={`py-0.5 ${isBullet ? "relative pl-4" : ""} ${
            isIndented ? "pl-4" : ""
          } ${isNumbered ? "pl-1" : ""}`}
        >
          {isBullet && <span className="absolute left-0 top-0.5 text-[#00d4dc]">•</span>}
          {renderInline(body)}
        </div>
      );
    })}
  </div>
);
