import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFileSync, mockKill } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockKill: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
}));

async function loadModule() {
  vi.resetModules();
  return import("../process-tree");
}

describe("killProcessTree", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockKill.mockReset();
    vi.stubGlobal("process", {
      ...process,
      platform: "darwin",
      kill: mockKill,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("kills descendants before the root process on macOS/Linux", async () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      const parentPid = args[1];
      if (parentPid === "100") return "101\n102\n";
      if (parentPid === "101") return "201\n";
      return "";
    });
    const root = { pid: 100, kill: vi.fn() };
    const { killProcessTree } = await loadModule();

    killProcessTree(root);

    expect(mockKill.mock.calls).toEqual([
      [201, "SIGTERM"],
      [101, "SIGTERM"],
      [102, "SIGTERM"],
    ]);
    expect(root.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses taskkill to terminate a process tree on Windows", async () => {
    vi.stubGlobal("process", {
      ...process,
      platform: "win32",
      kill: mockKill,
    });
    const root = { pid: 100, kill: vi.fn() };
    const { killProcessTree } = await loadModule();

    killProcessTree(root);

    expect(mockExecFileSync).toHaveBeenCalledWith("taskkill", ["/pid", "100", "/T", "/F"], {
      stdio: "ignore",
      timeout: 1000,
    });
    expect(root.kill).not.toHaveBeenCalled();
  });

  it("falls back to the process kill method when Windows taskkill fails", async () => {
    vi.stubGlobal("process", {
      ...process,
      platform: "win32",
      kill: mockKill,
    });
    mockExecFileSync.mockImplementation(() => {
      throw new Error("taskkill unavailable");
    });
    const root = { pid: 100, kill: vi.fn() };
    const { killProcessTree } = await loadModule();

    killProcessTree(root);

    expect(root.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
