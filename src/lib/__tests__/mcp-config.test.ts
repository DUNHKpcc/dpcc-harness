import { describe, expect, it } from "vitest";
import {
  buildSdkMcpConfigSync,
  normalizeMcpStdioServer,
  type McpServerInput,
} from "@shared/lib/mcp-config";

const npmExecServer: McpServerInput = {
  name: "xcodebuild",
  transport: "stdio",
  command: "npm",
  args: ["exec", "xcodebuildmcp@latest", "mcp"],
};

describe("normalizeMcpStdioServer", () => {
  it("rewrites npm exec MCP launchers on macOS to avoid Dock entries named exec", () => {
    expect(normalizeMcpStdioServer(npmExecServer, { platform: "darwin" })).toEqual({
      ...npmExecServer,
      command: "npx",
      args: ["--yes", "xcodebuildmcp@latest", "mcp"],
    });
  });

  it("preserves absolute npm sibling paths when rewriting on macOS", () => {
    const result = normalizeMcpStdioServer({
      ...npmExecServer,
      command: "/opt/homebrew/bin/npm",
    }, { platform: "darwin" });

    expect(result.command).toBe("/opt/homebrew/bin/npx");
  });

  it("does not duplicate an existing assume-yes flag", () => {
    const result = normalizeMcpStdioServer({
      ...npmExecServer,
      args: ["exec", "--yes", "xcodebuildmcp@latest", "mcp"],
    }, { platform: "darwin" });

    expect(result.args).toEqual(["--yes", "xcodebuildmcp@latest", "mcp"]);
  });

  it("leaves non-macOS and non-npm stdio launchers unchanged", () => {
    expect(normalizeMcpStdioServer(npmExecServer, { platform: "linux" })).toEqual(npmExecServer);

    const nodeServer: McpServerInput = {
      name: "local",
      transport: "stdio",
      command: "node",
      args: ["server.mjs"],
    };
    expect(normalizeMcpStdioServer(nodeServer, { platform: "darwin" })).toEqual(nodeServer);
  });
});

describe("buildSdkMcpConfigSync", () => {
  it("uses normalized stdio commands in generated SDK config", () => {
    expect(buildSdkMcpConfigSync([npmExecServer], { platform: "darwin" })).toEqual({
      xcodebuild: {
        command: "npx",
        args: ["--yes", "xcodebuildmcp@latest", "mcp"],
        env: undefined,
      },
    });
  });
});
