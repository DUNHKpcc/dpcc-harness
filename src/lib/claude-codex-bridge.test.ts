import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODEX_BRIDGE_SERVER_NAME,
  appendClaudeCodexBridgeServer,
} from "@shared/lib/claude-codex-bridge";
import type { McpServerInput } from "@shared/lib/mcp-config";

describe("appendClaudeCodexBridgeServer", () => {
  const baseConfig = {
    command: "/Applications/PccAgent.app/Contents/MacOS/PccAgent",
    args: ["/app/electron/dist/claude-codex-mcp.js"],
    endpoint: "http://127.0.0.1:43210",
    token: "secret-token",
  };

  it("returns the original servers when disabled", () => {
    const existing: McpServerInput[] = [{ name: "context7", transport: "stdio", command: "npx", args: ["context7"] }];
    expect(appendClaudeCodexBridgeServer(existing, { ...baseConfig, enabled: false })).toEqual(existing);
  });

  it("appends the built-in bridge server when enabled", () => {
    const result = appendClaudeCodexBridgeServer([], { ...baseConfig, enabled: true });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: CLAUDE_CODEX_BRIDGE_SERVER_NAME,
      transport: "stdio",
      command: baseConfig.command,
      args: baseConfig.args,
      env: {
        HARNSS_CODEX_BRIDGE_URL: baseConfig.endpoint,
        HARNSS_CODEX_BRIDGE_TOKEN: baseConfig.token,
      },
    });
  });

  it("passes the owning Claude session id to the MCP helper", () => {
    const result = appendClaudeCodexBridgeServer([], {
      ...baseConfig,
      enabled: true,
      claudeSessionId: "claude-parent-1",
    });

    expect(result[0]?.env).toMatchObject({
      HARNSS_CLAUDE_SESSION_ID: "claude-parent-1",
    });
  });

  it("does not overwrite a user-configured server with the same name", () => {
    const userServer: McpServerInput = {
      name: CLAUDE_CODEX_BRIDGE_SERVER_NAME,
      transport: "stdio",
      command: "custom-codex",
      args: ["mcp-server"],
    };
    expect(appendClaudeCodexBridgeServer([userServer], { ...baseConfig, enabled: true })).toEqual([userServer]);
  });
});
