import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PROMPT_TEXT_FILE_BYTES } from "../../lib/prompt-file-read";

const { mockIpcMainHandle, mockGitExec } = vi.hoisted(() => ({
  mockIpcMainHandle: vi.fn(),
  mockGitExec: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
    trashItem: vi.fn(),
    openPath: vi.fn(),
  },
}));

vi.mock("../../lib/git-exec", () => ({
  ALWAYS_SKIP: new Set([".git", "node_modules"]),
  gitExec: mockGitExec,
  isGitNotFoundError: vi.fn(() => false),
  isNotGitRepositoryError: vi.fn(() => false),
}));

vi.mock("../../lib/error-utils", () => ({
  reportError: (_label: string, err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

async function loadModule() {
  vi.resetModules();
  return import("../files");
}

function handlerFor<TArgs extends unknown[], TResult>(channel: string) {
  const call = mockIpcMainHandle.mock.calls.find(([registered]) => registered === channel);
  return call?.[1] as ((_event: unknown, ...args: TArgs) => Promise<TResult>) | undefined;
}

describe("files IPC", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-ipc-"));
    mockIpcMainHandle.mockReset();
    mockGitExec.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads large UTF-8 files through file:read without prompt attachment limits", async () => {
    const filePath = path.join(tmpDir, "large.txt");
    const content = "x".repeat(MAX_PROMPT_TEXT_FILE_BYTES + 1);
    fs.writeFileSync(filePath, content, "utf-8");

    const { register } = await loadModule();
    register(() => null);

    const readFile = handlerFor<[string], { content?: string; error?: string }>("file:read");
    expect(readFile).toBeDefined();

    const result = await readFile!(null, filePath);

    expect(result).toEqual({ content });
  });

  it("does not count known binary files against deep folder prompt size limits", async () => {
    const docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir);
    fs.writeFileSync(path.join(docsDir, "note.txt"), "hello", "utf-8");
    fs.writeFileSync(path.join(docsDir, "image.png"), Buffer.alloc(MAX_PROMPT_TEXT_FILE_BYTES));
    mockGitExec.mockResolvedValue("docs/note.txt\ndocs/image.png\n");

    const { register } = await loadModule();
    register(() => null);

    const readMultiple = handlerFor<
      [{ cwd: string; paths: string[]; deepPaths?: string[] }],
      Array<{ path: string; content?: string; error?: string; isDir?: boolean; tree?: string }>
    >("files:read-multiple");
    expect(readMultiple).toBeDefined();

    const results = await readMultiple!(null, {
      cwd: tmpDir,
      paths: ["docs"],
      deepPaths: ["docs"],
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "docs", isDir: true }),
        { path: "docs/note.txt", content: "hello" },
        expect.objectContaining({ path: "docs/image.png", error: expect.stringContaining("binary") }),
      ]),
    );
    expect(results).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "docs", error: expect.stringContaining("Deep folder content too large") }),
      ]),
    );
  });
});
