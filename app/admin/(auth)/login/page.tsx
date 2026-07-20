import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import { PageHeader } from "@/app/components/ui";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminLoginPage() {
  if (!isAdminConfigured()) redirect("/setup");
  return (
    <main className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <PageHeader eyebrow="Admin" title="Sign in" description="Manage backups and settings." />
      <LoginForm />
    </main>
  );
}