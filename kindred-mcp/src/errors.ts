import type { KindredConfig } from "./config.js";

/** Errors raised by the KindredClient when talking to the Kindred HTTP API. */
export class KindredApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "KindredApiError";
  }
}

/** Maps any thrown error to a human-readable message suitable for an MCP tool error. */
export function toToolErrorMessage(err: unknown, config: KindredConfig): string {
  if (err instanceof KindredApiError) {
    if (err.status === 401) {
      return (
        "Unauthorized. Check that KINDRED_TOKEN matches this Kindred " +
        "instance's token (see `npm run print:feed-token` on the Kindred host)."
      );
    }
    return err.message;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `Could not reach Kindred at ${config.baseUrl}: ${msg}. Check KINDRED_URL.`;
}
