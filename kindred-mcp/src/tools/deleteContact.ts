import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KindredClient } from "../kindredClient.js";
import type { KindredConfig } from "../config.js";
import { toToolErrorMessage } from "../errors.js";

export function registerDeleteContact(
  server: McpServer,
  client: KindredClient,
  config: KindredConfig,
): void {
  server.registerTool(
    "delete_contact",
    {
      title: "Delete a Kindred contact",
      description:
        "Permanently delete a contact. Deletion is irreversible, so this " +
        "tool requires two steps: call it first with just `id` (or with " +
        "`confirm: false`) to fetch the contact's details and a confirmation " +
        "prompt, then call it again with `confirm: true` to actually delete. " +
        "Always show the contact to the user and get their explicit approval " +
        "before the confirming call.",
      inputSchema: {
        id: z.number().int().positive().describe("The contact id to delete."),
        confirm: z
          .boolean()
          .optional()
          .describe(
            "Must be true to actually delete. Omit or false = dry-run preview only.",
          ),
      },
    },
    async ({ id, confirm }) => {
      try {
        if (confirm !== true) {
          // Dry run: show what would be deleted.
          const contact = await client.getContact(id);
          if (!contact) {
            return {
              isError: true,
              content: [
                { type: "text" as const, text: `Contact ${id} not found.` },
              ],
            };
          }
          const fullName = [contact.first_name, contact.last_name]
            .filter(Boolean)
            .join(" ");
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Confirmation required. This will permanently delete ` +
                  `${fullName} (id ${id}).\n\n` +
                  JSON.stringify(contact, null, 2) +
                  `\n\nCall delete_contact again with id ${id} and confirm: ` +
                  `true to proceed.`,
              },
            ],
          };
        }

        const deleted = await client.deleteContact(id);
        if (!deleted) {
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
              text: JSON.stringify({ status: "deleted", id }),
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
