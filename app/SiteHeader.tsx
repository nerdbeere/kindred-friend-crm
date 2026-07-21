"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import SpiritMark from "./SpiritMark";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/contacts", label: "Contacts" },
  { href: "/admin", label: "Admin" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-night/15 bg-[#f8f2e9]/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-night" onClick={() => setOpen(false)}>
          <SpiritMark className="h-9 w-9 text-sand-shadow" />
          <span className="text-lg font-bold tracking-tight">Kindred</span>
        </Link>
        <button
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="rounded-lg p-2 text-night hover:bg-sand/30 sm:hidden"
        >
          <span className="block h-0.5 w-5 bg-current" />
          <span className="mt-1 block h-0.5 w-5 bg-current" />
          <span className="mt-1 block h-0.5 w-5 bg-current" />
        </button>
        <nav className={`${open ? "absolute left-0 top-16 flex" : "hidden"} w-full flex-col gap-1 border-b border-night/15 bg-[#f8f2e9] p-3 sm:static sm:flex sm:w-auto sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:p-0`}>
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${active ? "bg-night text-[#f8f2e9]" : "text-night/75 hover:bg-sand/30 hover:text-night"}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
