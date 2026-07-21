#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { KindredClient } from "./kindredClient.js";
import { registerAllTools } from "./tools/index.js";

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }

  const client = new KindredClient(config);
  const server = new McpServer({
    name: "kindred-mcp",
    version: "0.1.0",
  });

  registerAllTools(server, client, config);

  const transport = new StdioServerTransport();
  server
    .connect(transport)
    .then(() => {
      // Server is running. Log to stderr only - stdout is reserved for JSON-RPC.
      process.stderr.write(
        `kindred-mcp connected to ${config.baseUrl} via stdio\n`,
      );
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`kindred-mcp failed to start: ${msg}\n`);
      process.exit(1);
    });
}

main();
