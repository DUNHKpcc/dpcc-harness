import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("global MCP store", () => {
  let root: string;
  let values: Map<string, unknown>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-global-mcp-"));
    values = new Map();
    fs.mkdirSync(path.join(root, "mcp"), { recursive: true });
    fs.writeFileSync(path.join(root, "mcp", "project-a.json"), JSON.stringify([{
      name: "legacy",
      transport: "stdio",
      command: "legacy-mcp",
    }]));
    vi.resetModules();
    vi.doMock("../data-dir", () => ({ getDataDir: () => root }));
    vi.doMock("../json-file-store", () => ({
      JsonFileStore: class<T> {
        load(key: string): T | null { return values.get(key) as T ?? null; }
        save(key: string, value: T): void { values.set(key, value); }
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock("../data-dir");
    vi.doUnmock("../json-file-store");
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("merges legacy project records once and does not restore removed servers", async () => {
    const { loadMcpServers, removeMcpServer } = await import("../mcp-store");

    expect(loadMcpServers().map((server) => server.name)).toEqual(["legacy"]);
    removeMcpServer("legacy");
    expect(loadMcpServers()).toEqual([]);
  });
});
