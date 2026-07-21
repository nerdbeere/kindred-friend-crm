import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KindredClient } from "../kindredClient.js";
import type { KindredConfig } from "../config.js";
import { toToolErrorMessage } from "../errors.js";
import { contactInputSchema } from "../types.js";

export function registerCreateContact(
  server: McpServer,
  client: KindredClient,
  config: KindredConfig,
): void {
  server.registerTool(
    "create_contact",
    {
      title: "Create a Kindred contact",
      description:
        "Create a new contact in Kindred. `first_name`, `birth_month`, and " +
        "`birth_day` are required; `last_name`, `birth_year`, and `notes` are " +
        "optional. If the user gives a birthday without a year, omit " +
        "`birth_year` (or pass null) - never guess a year. Returns the newly " +
        "created contact including its `id` and `days_until`.",
      inputSchema: contactInputSchema.shape,
    },
    async (input) => {
      try {
        const contact = await client.createContact(input);
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
