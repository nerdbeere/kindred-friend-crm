import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/app/components/ui";
import { isAdminConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminIndexPage() {
  if (!isAdminConfigured()) redirect("/setup");

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Keep Kindred healthy"
        description="Manage backups, access to your data, and AI integrations from one place."
      />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <OverviewCard href="/admin/backups" eyebrow="Data protection" title="Backups" description="Configure encrypted backups, check their health, and restore a snapshot when needed." action="Manage backups" />
        <OverviewCard href="/admin/access" eyebrow="Security" title="Access" description="Change the admin password and reveal the shared token used by calendar and AI connections." action="Manage access" />
        <OverviewCard href="/admin/developer" eyebrow="Integrations" title="Developer" description="Connect an MCP-compatible AI assistant or use the authenticated agent API directly." action="Connect an assistant" />
      </div>
    </div>
  );
}

function OverviewCard({ href, eyebrow, title, description, action }: { href: string; eyebrow: string; title: string; description: string; action: string }) {
  return (
    <Card className="flex flex-col p-5">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">{eyebrow}</p>
      <h2 className="mt-2 text-lg font-bold text-night">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-night/60">{description}</p>
      <Link href={href} className="mt-5 text-sm font-bold text-night underline decoration-sand-shadow/60 underline-offset-4 hover:text-night-shadow">
        {action} <span aria-hidden="true">&rarr;</span>
      </Link>
    </Card>
  );
}
