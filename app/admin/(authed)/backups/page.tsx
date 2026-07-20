import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import BackupsClient from "./BackupsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminBackupsPage() {
  if (!isAdminConfigured()) redirect("/setup");
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Encrypted backups</h2>
      <p className="mt-1 text-sm text-stone-500">
        Client-side AES-256 via <code>restic</code>. Snapshots are encrypted before they leave the container.
      </p>
      <BackupsClient />
    </div>
  );
}