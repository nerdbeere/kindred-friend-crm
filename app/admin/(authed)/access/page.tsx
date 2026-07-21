import { redirect } from "next/navigation";
import { getFeedToken, isAdminConfigured } from "@/lib/db";
import { PageHeader } from "@/app/components/ui";
import AccessClient from "./AccessClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AccessPage() {
  if (!isAdminConfigured()) redirect("/setup");
  return (
    <div>
      <PageHeader eyebrow="Administration / Security" title="Access" description="Manage the admin password and the shared secret used by calendar and AI integrations." />
      <AccessClient token={getFeedToken()} />
    </div>
  );
}
