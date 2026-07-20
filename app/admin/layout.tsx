import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdminConfigured } from "@/lib/db";
import { isAuthenticatedServer } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABS = [
  { href: "/admin/backups", label: "Backups" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isAdminConfigured()) redirect("/setup");
  if (!(await isAuthenticatedServer())) redirect("/admin/login");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Kindred admin</h1>
          <p className="text-xs text-stone-500">Manage backups and settings.</p>
        </div>
        <form action="/api/admin/logout" method="post" className="text-sm">
          <button type="submit" className="rounded border border-stone-300 px-3 py-1 text-stone-700">
            Sign out
          </button>
        </form>
      </header>
      <nav className="mt-4 flex gap-4 text-sm">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="text-stone-700 underline-offset-4 hover:underline">
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </main>
  );
}