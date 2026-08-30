import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverLocalMcpServers } from "../local-mcp-discovery";
import { discoverLocalSkills } from "../local-skill-discovery";
import type { InstalledSkillRecord } from "../../../../shared/types/plugins";

describe("local agent discovery", () => {
  let root: string;
  let homeDirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-agent-discovery-"));
    homeDirSpy = vi.spyOn(os, "homedir").mockReturnValue(root);
  });

  afterEach(() => {
    homeDirSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("discovers local JSON and Codex TOML MCP entries without exposing credentials", () => {
    fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({
      mcpServers: {
        filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], env: { TOKEN: "secret" } },
      },
    }));
    fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(root, ".codex", "config.toml"), [
      "[mcp_servers.browser]",
      'command = "npx"',
      'args = ["-y", "browser-mcp"]',
    ].join("\n"));

    const records = discoverLocalMcpServers([{
      name: "git",
      transport: "stdio",
      command: "git-mcp",
    }]);

    expect(records.map((record) => [record.source, record.server.name])).toEqual([
      ["PccAgent", "git"],
      ["Local MCP", "filesystem"],
      ["Codex", "browser"],
    ]);
    expect(records.find((record) => record.server.name === "filesystem")?.server.env).toBeUndefined();
  });

  it("discovers Claude and Codex Skills while leaving PccAgent-managed paths alone", () => {
    const managedPath = path.join(root, ".agents", "skills", "managed");
    const codexPath = path.join(root, ".codex", "plugins", "cache", "example", "skills", "local-codex");
    fs.mkdirSync(managedPath, { recursive: true });
    fs.mkdirSync(codexPath, { recursive: true });
    fs.writeFileSync(path.join(managedPath, "SKILL.md"), "---\nname: managed\n---\n");
    fs.writeFileSync(path.join(codexPath, "SKILL.md"), "---\nname: local-codex\n---\n");
    const managed: InstalledSkillRecord[] = [{
      id: "managed",
      catalogId: "managed",
      name: "managed",
      source: "owner/repo",
      sourceRevision: "revision",
      contentHash: "hash",
      scope: "global",
      targets: ["pi"],
      installPaths: [managedPath],
      installedAt: new Date(0).toISOString(),
    }];

    expect(discoverLocalSkills(managed)).toMatchObject([{
      name: "local-codex",
      origin: "Codex",
      managed: false,
      installPaths: [codexPath],
    }]);
  });
});
