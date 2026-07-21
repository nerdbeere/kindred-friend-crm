import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KindredClient } from "../kindredClient.js";
import type { KindredConfig } from "../config.js";
import { toToolErrorMessage } from "../errors.js";

export function registerListContacts(
  server: McpServer,
  client: KindredClient,
  config: KindredConfig,
): void {
  server.registerTool(
    "list_contacts",
    {
      title: "List Kindred contacts",
      description:
        "List contacts from the Kindred CRM, sorted by upcoming birthday " +
        "(soonest first). Optionally filter by a case-insensitive substring " +
        "match on name/notes (`q`) and/or by birthdays within the next N days " +
        "(`within_days`, 0-3660). Each result includes `days_until` (days " +
        "until that contact's next birthday). For generic 'upcoming birthdays' " +
        "questions with no explicit timeframe, use within_days: 30.",
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe(
            "Case-insensitive substring to match against first name, last name, and notes.",
          ),
        within_days: z
          .number()
          .int()
          .min(0)
          .max(3660)
          .optional()
          .describe(
            "Only return contacts whose next birthday is within this many days (0-3660).",
          ),
      },
    },
    async ({ q, within_days }) => {
      try {
        const contacts = await client.listContacts({ q, withinDays: within_days });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(contacts, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: toToolErrorMessage(err, config) },
          ],
        };
      }
    },
  );
}
