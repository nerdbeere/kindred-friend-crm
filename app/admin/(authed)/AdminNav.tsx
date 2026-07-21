"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminNav({ tabs }: { tabs: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Administration" className="mt-4 overflow-x-auto">
      <div className="flex w-max min-w-full gap-1 rounded-xl bg-paper p-1 text-sm">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-3 py-2 font-semibold transition ${active ? "bg-white text-night shadow-sm ring-1 ring-night/10" : "text-night/60 hover:bg-white/70 hover:text-night"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
