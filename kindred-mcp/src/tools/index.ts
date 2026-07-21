import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KindredClient } from "../kindredClient.js";
import type { KindredConfig } from "../config.js";
import { registerListContacts } from "./listContacts.js";
import { registerGetContact } from "./getContact.js";
import { registerCreateContact } from "./createContact.js";
import { registerUpdateContact } from "./updateContact.js";
import { registerDeleteContact } from "./deleteContact.js";

export function registerAllTools(
  server: McpServer,
  client: KindredClient,
  config: KindredConfig,
): void {
  registerListContacts(server, client, config);
  registerGetContact(server, client, config);
  registerCreateContact(server, client, config);
  registerUpdateContact(server, client, config);
  registerDeleteContact(server, client, config);
}
