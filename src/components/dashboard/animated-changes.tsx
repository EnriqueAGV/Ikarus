"use client";

import { useLayoutEffect, useRef } from "react";

type Snapshot = { content: string; top: number; left: number };

// Server-rendered children keep their existing markup and form state. Only
// rows whose displayed data changed animate after a live refresh.
export function AnimatedChanges({ children, className }: { children: React.ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<Map<string, Snapshot> | null>(null);

  useLayoutEffect(() => {
    if (!root.current) return;
    const rows = Array.from(root.current.querySelectorAll<HTMLElement>("[data-live-row]"));
    const current = new Map(rows.map(row => {
      const rect = row.getBoundingClientRect();
      return [row.dataset.liveRow!, {
        content: `${row.dataset.liveVersion ?? ""}:${row.textContent}`,
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
      }];
    }));
    const before = previous.current;
    previous.current = current;
    if (!before || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const changed = before.size !== current.size || [...current].some(([id, row]) => before.get(id)?.content !== row.content);
    if (!changed) return;

    const animations: Animation[] = [];
    const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
    for (const row of rows) {
      if (!row.getClientRects().length || typeof row.animate !== "function") continue;
      const id = row.dataset.liveRow!;
      const old = before.get(id);
      const next = current.get(id)!;
      if (!old) {
        animations.push(row.animate([
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "none" },
        ], { duration: 360, easing }));
      } else if (old.top !== next.top || old.left !== next.left) {
        animations.push(row.animate([
          { transform: `translate(${old.left - next.left}px, ${old.top - next.top}px)` },
          { transform: "none" },
        ], { duration: 360, easing }));
      }
      if (!old || old.content !== next.content) {
        // An inset wash keeps appointment status colors underneath it.
        animations.push(row.animate([
          { boxShadow: "inset 0 0 0 999px rgb(6 69 159 / 0.10)", offset: 0 },
          { boxShadow: "inset 0 0 0 999px rgb(6 69 159 / 0.10)", offset: 0.2 },
          { boxShadow: "inset 0 0 0 999px rgb(6 69 159 / 0)", offset: 1 },
        ], { duration: 1200, easing: "ease-out" }));
      }
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => animations.forEach(animation => animation.cancel());
    motion.addEventListener("change", cancel);
    return () => { cancel(); motion.removeEventListener("change", cancel); };
  }, [children]);

  return <div ref={root} className={className}>{children}</div>;
}
