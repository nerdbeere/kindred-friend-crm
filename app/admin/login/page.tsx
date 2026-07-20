import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminLoginPage() {
  if (!isAdminConfigured()) redirect("/setup");
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Kindred admin</h1>
      <p className="mt-1 text-sm text-stone-500">Sign in to manage backups and settings.</p>
      <LoginForm />
    </main>
  );
}