import { describe, expect, it } from "vitest";
import { applyClaudeMcpIsolation } from "../claude-mcp-isolation";

describe("applyClaudeMcpIsolation", () => {
  it("enables strict MCP config without removing explicit Harnss MCP servers", () => {
    const options: Record<string, unknown> = {
      mcpServers: {
        local: { command: "node", args: ["server.mjs"] },
      },
    };

    applyClaudeMcpIsolation(options);

    expect(options).toEqual({
      strictMcpConfig: true,
      mcpServers: {
        local: { command: "node", args: ["server.mjs"] },
      },
    });
  });
});
