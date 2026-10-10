"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links }: { links: { href: string; label: string; exact?: boolean; badge?: number }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto text-sm">
      {links.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 ${
              active ? "bg-brand text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }`}
          >
            {l.label}
            {!!l.badge && (
              <span
                className={`ml-1.5 rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-white/25" : "bg-amber-100 text-amber-900"}`}
              >
                {l.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
