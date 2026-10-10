"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string; exact?: boolean; badge?: number };

// A segmented control: a white pill slides under the current section.
export function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const active = links.findIndex((l) => (l.exact ? pathname === l.href : pathname.startsWith(l.href)));
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const el = refs.current[active];
    if (!el) return setPill(null);
    setPill({ left: el.offsetLeft, width: el.offsetWidth });
    // No slide on the first paint, only between sections.
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [active, links.length]);

  return (
    <nav className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="relative inline-flex rounded-full bg-black/[0.05] p-1 text-sm">
        {pill && (
          <span
            aria-hidden
            className={`absolute top-1 bottom-1 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.1),0_1px_1px_rgb(0_0_0/0.04)] ${
              animate ? "transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" : ""
            }`}
            style={{ left: pill.left, width: pill.width }}
          />
        )}
        {links.map((l, i) => (
          <Link
            key={l.href}
            href={l.href}
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-current={i === active ? "page" : undefined}
            className={`relative z-10 flex items-center whitespace-nowrap rounded-full px-3.5 py-1.5 ${
              i === active ? "font-medium text-foreground" : "text-neutral-600 hover:text-foreground"
            }`}
          >
            {l.label}
            {!!l.badge && (
              <span className="ml-1.5 min-w-5 rounded-full bg-brand px-1.5 text-center text-[11px] leading-5 font-semibold text-white tabular-nums">
                {l.badge}
              </span>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
