import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KindredClient } from "../kindredClient.js";
import type { KindredConfig } from "../config.js";
import { toToolErrorMessage } from "../errors.js";

export function registerGetContact(
  server: McpServer,
  client: KindredClient,
  config: KindredConfig,
): void {
  server.registerTool(
    "get_contact",
    {
      title: "Get a single Kindred contact",
      description:
        "Fetch a single Kindred contact by its numeric id. Returns the full " +
        "contact record including `days_until` (days until the next birthday).",
      inputSchema: {
        id: z.number().int().positive().describe("The contact id."),
      },
    },
    async ({ id }) => {
      try {
        const contact = await client.getContact(id);
        if (!contact) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: `Contact ${id} not found.` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(contact, null, 2),
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
