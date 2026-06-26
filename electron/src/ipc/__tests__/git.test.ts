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

vi.mock("../../lib/posthog", () => ({
  captureEvent: vi.fn(),
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
});
