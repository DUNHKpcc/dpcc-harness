import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIpcMainHandle,
  mockGitExec,
  mockIsGitExecError,
  mockReportError,
} = vi.hoisted(() => ({
  mockIpcMainHandle: vi.fn(),
  mockGitExec: vi.fn(),
  mockIsGitExecError: vi.fn(),
  mockReportError: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

vi.mock("../../lib/git-exec", () => ({
  ALWAYS_SKIP: new Set([".git", "node_modules"]),
  gitExec: mockGitExec,
  isGitExecError: mockIsGitExecError,
}));

vi.mock("../../lib/error-utils", () => ({
  extractErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  reportError: mockReportError,
}));

async function loadModule() {
  vi.resetModules();
  return import("../git");
}

function handlerFor<TArgs extends unknown[], TResult>(channel: string) {
  const call = mockIpcMainHandle.mock.calls.find(([registered]) => registered === channel);
  return call?.[1] as ((_event: unknown, ...args: TArgs) => Promise<TResult>) | undefined;
}

describe("git IPC", () => {
  beforeEach(() => {
    mockIpcMainHandle.mockReset();
    mockGitExec.mockReset();
    mockIsGitExecError.mockReset();
    mockReportError.mockReset();
    mockReportError.mockImplementation((_label: string, err: unknown) => (err instanceof Error ? err.message : String(err)));
  });

  it("short-circuits repeated git status calls for the same non-git cwd", async () => {
    const notRepoError = Object.assign(
      new Error("fatal: not a git repository (or any of the parent directories): .git"),
      { kind: "not-git-repository" },
    );
    mockGitExec.mockRejectedValue(notRepoError);
    mockIsGitExecError.mockImplementation((err: unknown) => err === notRepoError);

    const { register } = await loadModule();
    register();

    const gitStatus = handlerFor<[string], { error?: string; kind?: string }>("git:status");
    expect(gitStatus).toBeDefined();

    const first = await gitStatus!(null, "/tmp/not-a-repo");
    const second = await gitStatus!(null, "/tmp/not-a-repo");

    expect(first).toEqual({
      error: "fatal: not a git repository (or any of the parent directories): .git",
      kind: "not-git-repository",
    });
    expect(second).toEqual(first);
    expect(mockGitExec).toHaveBeenCalledTimes(1);
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });

  it("parses NUL-delimited status records without corrupting special paths", async () => {
    const renamedPath = "docs/新\nname.txt";
    const oldPath = "docs/old\tname.txt";
    const modifiedPath = "docs/space and 中文.txt";
    const untrackedPath = "docs/back\\slash.txt";
    mockGitExec.mockResolvedValue([
      "# branch.head feature/special-paths",
      "# branch.upstream origin/feature/special-paths",
      "# branch.ab +2 -3",
      `2 R. N... 100644 100644 100644 abc def R100 ${renamedPath}`,
      oldPath,
      `1 .M N... 100644 100644 100644 abc def ${modifiedPath}`,
      `? ${untrackedPath}`,
      "",
    ].join("\0"));

    const { register } = await loadModule();
    register();

    const gitStatus = handlerFor<
      [string],
      {
        branch: string;
        upstream?: string;
        ahead: number;
        behind: number;
        files: Array<{ path: string; oldPath?: string; status: string; group: string }>;
      }
    >("git:status");
    expect(gitStatus).toBeDefined();

    const result = await gitStatus!(null, "/tmp/repo");

    expect(mockGitExec).toHaveBeenCalledWith(
      ["status", "--porcelain=v2", "--branch", "-z"],
      "/tmp/repo",
    );
    expect(result).toEqual({
      branch: "feature/special-paths",
      upstream: "origin/feature/special-paths",
      ahead: 2,
      behind: 3,
      files: [
        {
          path: renamedPath,
          oldPath,
          status: "renamed",
          group: "staged",
        },
        {
          path: modifiedPath,
          status: "modified",
          group: "unstaged",
        },
        {
          path: untrackedPath,
          status: "untracked",
          group: "untracked",
        },
      ],
    });
  });
});
