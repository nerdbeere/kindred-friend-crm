import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdminConfigured } from "@/lib/db";
import { isAuthenticatedServer } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABS = [
  { href: "/admin/backups", label: "Backups" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/developer", label: "Developer" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isAdminConfigured()) redirect("/setup");
  if (!(await isAuthenticatedServer())) redirect("/admin/login");

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between gap-3 border-b border-night/10 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">Admin</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-night">Kindred admin</h1>
        </div>
        <form action="/api/admin/logout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-night/20 px-3 py-1.5 text-sm font-semibold text-night hover:bg-sand/20"
          >
            Sign out
          </button>
        </form>
      </header>
      <nav className="mt-4 flex gap-1 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-lg px-3 py-1.5 font-semibold text-night/65 hover:bg-sand/20 hover:text-night"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </main>
  );
}
