import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAccessSync,
  mockExecFile,
  mockExecFileSync,
  mockGetAppSetting,
  mockLog,
  mockApp,
  mockOsArch,
  mockFsState,
  mockRenameSync,
  mockRmSync,
} = vi.hoisted(() => ({
  mockAccessSync: vi.fn(),
  mockExecFile: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockGetAppSetting: vi.fn<(key: string) => string>((key: string) => {
    if (key === "codexBinarySource") return "auto";
    if (key === "codexCustomBinaryPath") return "";
    return "PccAgent";
  }),
  mockLog: vi.fn(),
  mockApp: {
    isPackaged: true,
    getPath: vi.fn(() => "C:\\Users\\tester\\AppData\\Roaming\\PccAgent"),
  },
  mockOsArch: vi.fn(() => "x64"),
  mockFsState: {
    existing: new Set<string>(),
    executable: new Set<string>(),
  },
  mockRenameSync: vi.fn(),
  mockRmSync: vi.fn(),
}));

function normalize(filePath: string): string {
  return path.normalize(filePath);
}

function replacePrefix(sourcePath: string, from: string, to: string): string {
  if (sourcePath === from) return to;
  if (sourcePath.startsWith(`${from}\\`)) return `${to}${sourcePath.slice(from.length)}`;
  if (sourcePath.startsWith(`${from}/`)) return `${to}${sourcePath.slice(from.length)}`;
  return sourcePath;
}

function movePathEntries(sourcePath: string, destinationPath: string): void {
  const from = normalize(sourcePath);
  const to = normalize(destinationPath);
  const movedEntries = [...mockFsState.existing].filter(
    (entry) => entry === from || entry.startsWith(`${from}\\`) || entry.startsWith(`${from}/`),
  );
  const movedExecutables = [...mockFsState.executable].filter(
    (entry) => entry === from || entry.startsWith(`${from}\\`) || entry.startsWith(`${from}/`),
  );

  for (const entry of movedEntries) {
    mockFsState.existing.delete(entry);
    mockFsState.existing.add(replacePrefix(entry, from, to));
  }
  for (const entry of movedExecutables) {
    mockFsState.executable.delete(entry);
    mockFsState.executable.add(replacePrefix(entry, from, to));
  }
}

function defaultRenameSync(source: string, destination: string): void {
  const sourcePath = normalize(source);
  const destinationPath = normalize(destination);
  if (!mockFsState.existing.has(sourcePath)) {
    throw new Error(
      `ENOENT: no such file or directory, rename '${sourcePath}' -> '${destinationPath}'`,
    );
  }
  movePathEntries(sourcePath, destinationPath);
}

function removePath(targetPath: string): void {
  const target = normalize(targetPath);
  const toDelete = [...mockFsState.existing].filter(
    (entry) => entry === target || entry.startsWith(`${target}\\`) || entry.startsWith(`${target}/`),
  );
  for (const entry of toDelete) {
    mockFsState.existing.delete(entry);
  }
  const execDelete = [...mockFsState.executable].filter(
    (entry) => entry === target || entry.startsWith(`${target}\\`) || entry.startsWith(`${target}/`),
  );
  for (const entry of execDelete) {
    mockFsState.executable.delete(entry);
  }
}

vi.mock("fs", () => ({
  default: {
    accessSync: mockAccessSync,
    chmodSync: vi.fn(),
    constants: { X_OK: 1 },
    copyFileSync: vi.fn(),
    existsSync: (candidate: string) => mockFsState.existing.has(normalize(candidate)),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    renameSync: mockRenameSync.mockImplementation(defaultRenameSync),
    rmSync: mockRmSync.mockImplementation((target: string, options?: unknown) => {
      const normalized = normalize(target);
      removePath(normalized);
      return options;
    }),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  execFile: mockExecFile,
  execFileSync: mockExecFileSync,
}));

vi.mock("electron", () => ({
  app: mockApp,
}));

vi.mock("os", () => ({
  default: {
    arch: mockOsArch,
    tmpdir: () => "C:\\Temp",
  },
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

vi.mock("../logger", () => ({
  log: mockLog,
}));

vi.mock("../error-utils", () => ({
  reportError: vi.fn(),
}));

function allowExecutable(...filePaths: string[]): void {
  mockFsState.executable.clear();
  for (const filePath of filePaths) {
    mockFsState.executable.add(normalize(filePath));
  }
  mockAccessSync.mockImplementation((candidate: string) => {
    if (mockFsState.executable.has(normalize(candidate))) return;
    throw new Error("missing");
  });
}

function markPaths(...filePaths: string[]): void {
  for (const filePath of filePaths) {
    mockFsState.existing.add(normalize(filePath));
  }
}

function clearMockFsState(): void {
  mockFsState.existing.clear();
  mockFsState.executable.clear();
}

async function loadModule() {
  vi.resetModules();
  return import("../codex-binary");
}

describe("codex binary resolution", () => {
  beforeEach(() => {
    clearMockFsState();
    vi.restoreAllMocks();
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    Object.defineProperty(process, "resourcesPath", {
      value: "D:\\pcc\\PccAgent\\resources",
      configurable: true,
    });
    mockAccessSync.mockReset();
    mockExecFile.mockReset();
    mockExecFileSync.mockReset();
    mockGetAppSetting.mockReset();
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "codexBinarySource") return "auto";
      if (key === "codexCustomBinaryPath") return "";
      return "PccAgent";
    });
    mockLog.mockReset();
    mockOsArch.mockReturnValue("x64");
    mockApp.isPackaged = true;
    mockApp.getPath.mockReturnValue("C:\\Users\\tester\\AppData\\Roaming\\PccAgent");
    mockRenameSync.mockReset().mockImplementation(defaultRenameSync);
    mockRmSync.mockReset().mockImplementation((target: string) => {
      const normalized = normalize(target);
      removePath(normalized);
      return undefined;
    });
    mockAccessSync.mockImplementation(() => {
      throw new Error("missing");
    });
  });

  it("prefers the bundled Windows codex.exe over npm PATH shims in auto mode", async () => {
    const bundledPath = path.join(
      "D:\\pcc\\PccAgent\\resources",
      "codex-vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    );
    const npmShim = "C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\codex";
    allowExecutable(bundledPath, npmShim);
    mockExecFileSync.mockImplementation((command: string) => {
      if (command === "where") return `${npmShim}\r\n`;
      throw new Error("unexpected");
    });

    const mod = await loadModule();

    await expect(mod.getCodexBinaryPath()).resolves.toBe(bundledPath);
    expect(mockExecFileSync).not.toHaveBeenCalledWith("where", ["codex"], expect.anything());
  });

  it("maps Windows arm64 runtime fallback to the Windows x64 Codex package", async () => {
    mockOsArch.mockReturnValue("arm64");
    const mod = await loadModule();

    expect(mod.__test.getPlatformTag()).toBe("win32-x64");
    expect(mod.__test.getVendorTargetTriple()).toBe("x86_64-pc-windows-msvc");
  });

  it("uses async npm pack when auto-downloading a missing Codex binary", async () => {
    mockApp.isPackaged = false;
    mockAccessSync.mockImplementation(() => {
      throw new Error("missing");
    });
    mockExecFileSync.mockImplementation((command: string) => {
      if (command === "where") throw new Error("not found");
      if (command === "npm.cmd") throw new Error("sync npm should not run");
      throw new Error(`unexpected sync command: ${command}`);
    });
    mockExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback(new Error("network unavailable"));
    });

    const mod = await loadModule();

    await expect(mod.getCodexBinaryPath()).rejects.toThrow("network unavailable");
    expect(mockExecFile).toHaveBeenCalledWith(
      "npm.cmd",
      expect.arrayContaining(["pack", "@openai/codex@win32-x64"]),
      expect.objectContaining({ timeout: 120000 }),
      expect.any(Function),
    );
    expect(mockExecFileSync).not.toHaveBeenCalledWith(
      "npm.cmd",
      expect.arrayContaining(["pack", "@openai/codex@win32-x64"]),
      expect.anything(),
    );
  });

  function getManagedVendorPaths() {
    const managedVendorDir = path.join(
      "C:\\Users\\tester\\AppData\\Roaming\\PccAgent",
      "pcc-agent-data",
      "bin",
      "codex-vendor",
      "x86_64-pc-windows-msvc",
    );
    return {
      managedVendorDir,
      managedVendorBackup: `${managedVendorDir}.backup`,
    };
  }

  it("restores the old managed vendor when staging replacement fails", async () => {
    const mod = await loadModule();
    const { managedVendorDir, managedVendorBackup } = getManagedVendorPaths();
    const stagingDir = path.join("C:\\Temp", "codex-staging");
    const managedBinary = path.join(managedVendorDir, "bin", "codex.exe");
    const stagedBinary = path.join(stagingDir, "bin", "codex.exe");

    markPaths(managedVendorDir, `${managedVendorDir}\\bin`, managedBinary, stagingDir, `${stagingDir}\\bin`, stagedBinary);
    mockRenameSync.mockImplementation((source: string, destination: string) => {
      if (normalize(source) === normalize(stagingDir)) {
        throw new Error("staging rename failed");
      }
      return defaultRenameSync(source, destination);
    });

    expect(() => mod.__test.replaceManagedVendorDirectory(stagingDir)).toThrow("staging rename failed");
    expect(mockRenameSync).toHaveBeenCalledWith(managedVendorDir, managedVendorBackup);
    expect(mockRenameSync).toHaveBeenCalledWith(managedVendorBackup, managedVendorDir);
    expect(mockFsState.existing.has(normalize(managedVendorDir))).toBe(true);
    expect(mockFsState.existing.has(normalize(managedVendorBackup))).toBe(false);
    expect(mockFsState.existing.has(normalize(stagingDir))).toBe(true);
  });

  it("recovers a missing managed vendor from backup during startup", async () => {
    const mod = await loadModule();
    const { managedVendorDir, managedVendorBackup } = getManagedVendorPaths();
    const backupBinary = path.join(managedVendorBackup, "bin", "codex.exe");

    markPaths(managedVendorBackup, path.join(managedVendorBackup, "bin"), backupBinary);
    allowExecutable(backupBinary);

    mod.__test.recoverInterruptedManagedInstall();

    expect(mockRenameSync).toHaveBeenCalledWith(managedVendorBackup, managedVendorDir);
    expect(mockFsState.existing.has(normalize(managedVendorDir))).toBe(true);
    expect(mockFsState.existing.has(normalize(managedVendorBackup))).toBe(false);
  });

  it("cleans backup directory after successful managed vendor replacement", async () => {
    const mod = await loadModule();
    const { managedVendorDir, managedVendorBackup } = getManagedVendorPaths();
    const stagingDir = path.join("C:\\Temp", "codex-staging");
    const managedBinary = path.join(managedVendorDir, "bin", "codex.exe");
    const stagedBinary = path.join(stagingDir, "bin", "codex.exe");

    markPaths(
      managedVendorDir,
      `${managedVendorDir}\\bin`,
      managedBinary,
      stagingDir,
      `${stagingDir}\\bin`,
      stagedBinary,
    );

    mod.__test.replaceManagedVendorDirectory(stagingDir);

    expect(mockRenameSync).toHaveBeenCalledWith(managedVendorDir, managedVendorBackup);
    expect(mockRenameSync).toHaveBeenCalledWith(stagingDir, managedVendorDir);
    expect(mockRmSync).toHaveBeenCalledWith(managedVendorBackup, { recursive: true, force: true });
    expect(mockFsState.existing.has(normalize(managedVendorDir))).toBe(true);
    expect(mockFsState.existing.has(normalize(managedVendorBackup))).toBe(false);
  });
});
