import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAccessSync,
  mockExecFileSync,
  mockGetAppSetting,
  mockLog,
  mockApp,
  mockOsArch,
} = vi.hoisted(() => ({
  mockAccessSync: vi.fn(),
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
}));

vi.mock("fs", () => ({
  default: {
    accessSync: mockAccessSync,
    chmodSync: vi.fn(),
    constants: { X_OK: 1 },
    copyFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
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
  mockAccessSync.mockImplementation((candidate: string) => {
    if (filePaths.includes(candidate)) return;
    throw new Error("missing");
  });
}

async function loadModule() {
  vi.resetModules();
  return import("../codex-binary");
}

describe("codex binary resolution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    Object.defineProperty(process, "resourcesPath", {
      value: "D:\\pcc\\PccAgent\\resources",
      configurable: true,
    });
    mockAccessSync.mockReset();
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
});
