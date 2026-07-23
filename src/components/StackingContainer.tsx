import React, { useEffect, useRef, useState } from "react";

interface StackingContainerProps {
  children: React.ReactNode;
  cardBaseTop?: number; // default 100px
  cardTopStep?: number; // default 40px
}

export const StackingContainer: React.FC<StackingContainerProps> = ({
  children,
  cardBaseTop = 100,
  cardTopStep = 40,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setScrollY] = useState(0);

  useEffect(() => {
  const handleScroll = () => {
  setScrollY(window.scrollY);

  if (!containerRef.current) return;
  const cards = containerRef.current.querySelectorAll<HTMLDivElement>(
  "[data-stack-card]"
  );
  if (cards.length === 0) return;

  const cardArray = Array.from(cards) as HTMLDivElement[];
  const stickyTops = cardArray.map((_, i) => cardBaseTop + i * cardTopStep);

  // We calculate depth and apply transform values directly to each DOM card for optimal 60fps performance
  cardArray.forEach((card, i) => {
  let depth = 0;
  card.style.top = `${stickyTops[i]}px`;
  card.style.zIndex = `${(i + 1) * 10}`;

  // Scan subsequent cards to count how many are currently pinned/stacked on top of card i
  for (let j = i + 1; j < cardArray.length; j++) {
  const jTop = stickyTops[j];
  const jRect = cardArray[j].getBoundingClientRect();
  // if subsequent card has reached its sticky pin coordinate
  if (jRect.top <= jTop + 4) {
  depth++;
  }
  }

  const scale = Number((1 - depth * 0.04).toFixed(4));
  const translateY = depth * 8;
  const blur = 16 + depth * 8;
  const opacity = (0.05 + depth * 0.015).toFixed(3);

  if (depth === 0) {
  card.style.transform = "none";
  card.style.boxShadow = "0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 2px 6px -1px rgba(0, 0, 0, 0.02)";
  } else {
  card.style.transform = `scale(${scale}) translateY(${translateY}px)`;
  card.style.boxShadow = `0 2px 4px rgba(0,0,0,0.02), 0 ${blur}px ${blur}px rgba(0,0,0,${opacity})`;
  }
  });
  };

  window.addEventListener("scroll", handleScroll, { passive: true });
  // Run once on load and also add a short timeout to catch layout changes
  handleScroll();
  const timeoutId = setTimeout(handleScroll, 300);

  // Observe size changes to recalculate coordinates when elements expand/shrink
  const resizeObserver = new ResizeObserver(() => {
  handleScroll();
  });
  if (containerRef.current) {
  resizeObserver.observe(containerRef.current);
  }

  return () => {
  window.removeEventListener("scroll", handleScroll);
  clearTimeout(timeoutId);
  resizeObserver.disconnect();
  };
  }, [cardBaseTop, cardTopStep, children]);

  return (
  <div
  ref={containerRef}
  className="relative w-full flex flex-col gap-6- pb-[45vh] lg:pb-[60vh] perspective-[1400px] perspective-origin-[50%_0]"
  style={{ contentVisibility: "auto" }}
  >
  {children}
  </div>
  );
};

interface StackingCardProps {
  id: string;
  tag: string;
  title: string;
  colorTheme: {
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
  colorTheme,
  children,
}) => {
  // Map card IDs to beautiful, light-themed pristine glassmorphism styles with exactly 90% opacity
  const lightBgMap: Record<string, string> = {
  jd: "bg-[#161a1e] border-[rgba(255,255,255,0.07)]  hover:border-[rgba(0,212,220,0.3)]",
  uploads: "bg-[#161a1e] border-[rgba(255,255,255,0.07)]  hover:border-[rgba(0,212,220,0.3)]",
  notes: "bg-[#161a1e] border-[rgba(255,255,255,0.07)]  hover:border-[rgba(0,212,220,0.3)]",
  scoring: "bg-[#161a1e] border-[rgba(255,255,255,0.07)]  hover:border-[rgba(0,212,220,0.3)]",
  metric: "bg-[#161a1e] border-[rgba(255,255,255,0.07)]  hover:border-[rgba(0,212,220,0.3)]",
  report: "bg-[#161a1e] border-[rgba(255,255,255,0.07)]  hover:border-[rgba(0,212,220,0.3)]",
  };

  const currentBg = lightBgMap[id] || "bg-[#161a1e] border-[rgba(255,255,255,0.07)]  hover:border-[rgba(0,212,220,0.3)]";

  return (
  <article
  data-stack-card={id}
  className={`sticky w-full rounded-[10px] ${currentBg} border p-5 md:p-7 transform-gpu hover:scale-[1.012] transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] select-text flex flex-col gap-4 md:gap-5 mb-8 last:mb-0`}
  style={{
  transformOrigin: "top center",
  boxShadow: "0 20px 50px -12px rgba(0, 0, 0, 0.08), 0 4px 12px -2px rgba(0, 0, 0, 0.03)"
  }}
  >
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
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
  <div className="flex flex-col gap-4 text-[#9aa3b0] font-sans text-sm md:text-base leading-relaxed max-h-[calc(100vh-210px)] overflow-y-auto pr-1 select-text scrollbar-thin">
  {children}
  </div>
  </article>
  );
};
