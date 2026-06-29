import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import { parseJsonlToUIMessagesAsync } from "../cc-import";

const tempDirs: string[] = [];

function writeJsonl(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-import-test-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "session.jsonl");
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf-8");
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseJsonlToUIMessagesAsync", () => {
  it("parses Claude Code JSONL via the async importer", async () => {
    const filePath = writeJsonl([
      {
        type: "user",
        uuid: "u1",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { content: "hello" },
      },
      {
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { content: [{ type: "text", text: "hi there" }] },
      },
    ]);

    await expect(parseJsonlToUIMessagesAsync(filePath)).resolves.toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });
});
