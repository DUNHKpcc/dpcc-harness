/**
 * Built-in MCP bridge that lets Claude SDK sessions delegate work to a visible
 * Codex split pane. The shared helper here only computes the MCP server config;
 * the loopback controller and stdio helper live in the Electron main process.
 */
import type { McpServerInput } from "./mcp-config";

export const CLAUDE_CODEX_BRIDGE_SERVER_NAME = "harnss-codex";

export interface ClaudeCodexBridgeServerConfig {
  enabled: boolean;
  command: string;
  args: string[];
  endpoint: string;
  token: string;
}

/**
 * Append the built-in `harnss-codex` MCP server to the existing server list
 * when the per-session toggle is enabled. No-op when disabled, and never
 * overwrites a user-configured server that already uses the reserved name.
 */
export function appendClaudeCodexBridgeServer(
  servers: McpServerInput[],
  config: ClaudeCodexBridgeServerConfig,
): McpServerInput[] {
  if (!config.enabled) return servers;
  if (servers.some((server) => server.name === CLAUDE_CODEX_BRIDGE_SERVER_NAME)) return servers;
  return [
    ...servers,
    {
      name: CLAUDE_CODEX_BRIDGE_SERVER_NAME,
      transport: "stdio",
      command: config.command,
      args: config.args,
      env: {
        // The bridge command is the Electron binary; run it as plain Node.
        ELECTRON_RUN_AS_NODE: "1",
        HARNSS_CODEX_BRIDGE_URL: config.endpoint,
        HARNSS_CODEX_BRIDGE_TOKEN: config.token,
      },
    },
  ];
}
