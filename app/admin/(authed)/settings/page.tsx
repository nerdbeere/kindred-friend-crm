import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import { PageHeader } from "@/app/components/ui";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminSettingsPage() {
  if (!isAdminConfigured()) redirect("/setup");
  return (
    <div>
      <PageHeader title="Settings" description="Rotate your admin password." />
      <SettingsClient />
    </div>
  );
}