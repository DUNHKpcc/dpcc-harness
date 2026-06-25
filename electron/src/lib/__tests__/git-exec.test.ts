import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

async function loadModule() {
  vi.resetModules();
  return import("../git-exec");
}

describe("gitExec", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("classifies a missing git executable", async () => {
    mockExecFile.mockImplementation(
      (_command: string, _args: string[], _opts: unknown, cb: (err: NodeJS.ErrnoException, stdout: string, stderr: string) => void) => {
        const err = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        cb(err, "", "");
      },
    );
    const { gitExec, isGitNotFoundError } = await loadModule();

    let caught: unknown;
    try {
      await gitExec(["status"], "/repo");
    } catch (err) {
      caught = err;
    }

    expect(isGitNotFoundError(caught)).toBe(true);
    expect(caught).toMatchObject({
      kind: "git-not-found",
      command: "git status",
      message: "Git executable not found. Install Git or add it to PATH.",
    });
  });

  it("classifies a non-git repository cwd", async () => {
    mockExecFile.mockImplementation(
      (_command: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
        cb(new Error("failed"), "", "fatal: not a git repository (or any of the parent directories): .git\n");
      },
    );
    const { gitExec, isNotGitRepositoryError } = await loadModule();

    let caught: unknown;
    try {
      await gitExec(["status"], "/repo");
    } catch (err) {
      caught = err;
    }

    expect(isNotGitRepositoryError(caught)).toBe(true);
    expect(caught).toMatchObject({
      kind: "not-git-repository",
      command: "git status",
    });
  });
});
