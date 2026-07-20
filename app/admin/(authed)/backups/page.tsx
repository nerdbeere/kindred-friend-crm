import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import { PageHeader } from "@/app/components/ui";
import BackupsClient from "./BackupsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminBackupsPage() {
  if (!isAdminConfigured()) redirect("/setup");
  return (
    <div>
      <PageHeader
        title="Encrypted backups"
        description="Client-side AES-256 via restic. Snapshots are encrypted before they leave the container."
      />
      <BackupsClient />
    </div>
  );
}