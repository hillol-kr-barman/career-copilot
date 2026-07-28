import React from "react";

const DEFAULT_CARD_THEME = {
  text: "#00d4dc",
  bg: "rgba(0,212,220,0.08)",
  border: "rgba(0,212,220,0.2)",
};

interface StackingContainerProps {
  children: React.ReactNode;
}

export const StackingContainer: React.FC<StackingContainerProps> = ({ children }) => {
  return (
    <div className="relative w-full flex flex-col gap-6">
      {React.Children.map(children, (child, i) =>
        React.isValidElement<StackingCardProps>(child)
          ? React.cloneElement(child, { tag: child.props.tag ?? `Step ${i + 1}` })
          : child
      )}
    </div>
  );
};

interface StackingCardProps {
  id: string;
  tag?: string;
  title: string;
  colorTheme?: {
    text: string;
    bg: string;
    border: string;
  };
  children: React.ReactNode;
}

export const StackingCard: React.FC<StackingCardProps> = ({
  id,
  tag,
  title,
  colorTheme = DEFAULT_CARD_THEME,
  children,
}) => {
  return (
    <article
      className="w-full rounded-[10px] bg-[#161a1e] border border-[rgba(255,255,255,0.07)] p-5 md:p-7 select-text flex flex-col gap-4 md:gap-5"
      style={{
        boxShadow: "0 20px 50px -12px rgba(0, 0, 0, 0.08), 0 4px 12px -2px rgba(0, 0, 0, 0.03)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f7f4f4]/20 pb-3">
        <div className="flex items-center gap-2.5">
          <span
            className="px-2.5 py-0.5 text-[9px] md:text-xs font-semibold tracking-wider uppercase rounded-[4px] border"
            style={{
              color: colorTheme.text,
              backgroundColor: colorTheme.bg,
              borderColor: colorTheme.border,
            }}
          >
            {tag}
          </span>
          <h3 className="text-base md:text-lg font-medium tracking-tight text-[#eef0f3]">
            {title}
          </h3>
        </div>
        <div className="text-[9px] md:text-xs font-mono text-[#6b7685]">
          MODULE ID • {id.toUpperCase()}
        </div>
      </div>
      <div className="flex flex-col gap-4 text-[#9aa3b0] font-sans text-sm md:text-base leading-relaxed select-text">
        {children}
      </div>
    </article>
  );
};
