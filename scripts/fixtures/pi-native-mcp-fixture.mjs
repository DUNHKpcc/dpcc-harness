#!/usr/bin/env node

import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const markerPath = process.env.PI_MCP_FIXTURE_MARKER?.trim();
if (markerPath) fs.writeFileSync(markerPath, "started\n", { mode: 0o600 });

const server = new McpServer({ name: "pcc-agent-pi-mcp-fixture", version: "1.0.0" });
server.registerTool("fixture_echo", {
  description: "Echo fixture text for the PccAgent Pi MCP integration test.",
  inputSchema: { text: z.string() },
}, async ({ text }) => ({
  content: [{ type: "text", text }],
}));

await server.connect(new StdioServerTransport());
