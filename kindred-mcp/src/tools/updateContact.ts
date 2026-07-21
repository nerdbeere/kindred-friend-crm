import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KindredClient } from "../kindredClient.js";
import type { KindredConfig } from "../config.js";
import { toToolErrorMessage } from "../errors.js";
import type { ContactInput } from "../types.js";

const updateContactSchema = z.object({
  id: z.number().int().positive().describe("The contact id to update."),
  first_name: z
    .string()
    .min(1, "First name is required")
    .max(200, "First name is too long")
    .optional(),
  last_name: z.string().max(200, "Last name is too long").optional(),
  birth_month: z
    .number()
    .int()
    .min(1, "Birth month must be an integer between 1 and 12")
    .max(12, "Birth month must be an integer between 1 and 12")
    .optional(),
  birth_day: z
    .number()
    .int()
    .min(1, "Birth day is not valid for the given month")
    .max(31, "Birth day is not valid for the given month")
    .optional(),
  birth_year: z
    .number()
    .int()
    .min(1800)
    .max(new Date().getUTCFullYear())
    .nullable()
    .optional()
    .describe(
      "Pass null to explicitly clear an existing birth year; omit to leave it unchanged.",
    ),
  notes: z
    .string()
    .max(10000, "Notes must be text under 10000 characters")
    .optional(),
});

export function registerUpdateContact(
  server: McpServer,
  client: KindredClient,
  config: KindredConfig,
): void {
  server.registerTool(
    "update_contact",
    {
      title: "Update a Kindred contact (partial)",
      description:
        "Partially update an existing contact. Only the fields you pass are " +
        "changed; omitted fields keep their current values. Pass " +
        "`birth_year: null` to explicitly clear an existing birth year. " +
        "Returns the updated contact including `days_until`.",
      inputSchema: updateContactSchema.shape,
    },
    async (args) => {
      const { id, ...patch } = args;
      try {
        const existing = await client.getContact(id);
        if (!existing) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: `Contact ${id} not found.` },
            ],
          };
        }

        // Merge: only fields explicitly present in `patch` override.
        // `undefined` (omitted) -> keep existing; `null` on birth_year -> clear.
        const merged: ContactInput = {
          first_name: patch.first_name ?? existing.first_name,
          last_name: patch.last_name ?? existing.last_name,
          birth_month: patch.birth_month ?? existing.birth_month,
          birth_day: patch.birth_day ?? existing.birth_day,
          birth_year:
            patch.birth_year === undefined
              ? existing.birth_year
              : patch.birth_year,
          notes: patch.notes ?? existing.notes,
        };

        const updated = await client.replaceContact(id, merged);
        if (!updated) {
          // Race: existed a moment ago but is gone now.
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
              text: JSON.stringify(updated, null, 2),
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
