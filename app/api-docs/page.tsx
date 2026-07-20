import { getFeedToken } from "@/lib/db";
import ApiDocsClient from "./ApiDocsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kindred — Agent API",
};

export default function ApiDocsPage() {
  return <ApiDocsClient token={getFeedToken()} />;
}
