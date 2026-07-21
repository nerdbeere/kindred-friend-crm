import { redirect } from "next/navigation";
import { isAdminConfigured } from "@/lib/db";
import DeveloperClient from "./DeveloperClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Kindred — Developer setup",
};

export default function DeveloperPage() {
  if (!isAdminConfigured()) redirect("/setup");
  return <DeveloperClient />;
}
