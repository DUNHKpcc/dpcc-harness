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
      if (_command === "ps") {
        return "100 10\n101 100\n102 100\n103 101\n201 101\n202 102\n";
      }
      if (_command === "pgrep") {
        return "";
      }
      return "";
    });
    const root = { pid: 100, kill: vi.fn() };
    const { killProcessTree } = await loadModule();

    killProcessTree(root);

    expect(mockExecFileSync).toHaveBeenCalledWith("ps", ["-A", "-o", "pid=,ppid="], expect.any(Object));
    expect(mockExecFileSync).not.toHaveBeenCalledWith("pgrep", expect.any(Array), expect.any(Object));
    expect(mockKill.mock.calls).toEqual([
      [103, "SIGTERM"],
      [201, "SIGTERM"],
      [101, "SIGTERM"],
      [202, "SIGTERM"],
      [102, "SIGTERM"],
    ]);
    expect(root.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("falls back to recursive pgrep when ps snapshot collection fails", async () => {
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "ps") {
        throw new Error("ps unavailable");
      }
      if (command === "pgrep") {
        if (args[1] === "100") return "101\n102\n";
        if (args[1] === "101") return "201\n";
      }
      return "";
    });
    const root = { pid: 100, kill: vi.fn() };
    const { killProcessTree } = await loadModule();

    killProcessTree(root);

    expect(mockExecFileSync).toHaveBeenCalledWith("ps", ["-A", "-o", "pid=,ppid="], expect.any(Object));
    expect(mockExecFileSync).toHaveBeenCalledWith("pgrep", ["-P", "100"], expect.any(Object));
    expect(mockExecFileSync).toHaveBeenCalledWith("pgrep", ["-P", "101"], expect.any(Object));
    expect(mockExecFileSync).toHaveBeenCalledWith("pgrep", ["-P", "102"], expect.any(Object));
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
