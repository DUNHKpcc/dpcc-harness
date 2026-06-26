import { afterEach, describe, expect, it, vi } from "vitest";

const originalPlatform = process.platform;
const originalArch = process.arch;

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: (() => {
    const fn = vi.fn();
    return Object.assign(fn, {
      [Symbol.for("nodejs.util.promisify.custom")]: (
        command: string,
        args: string[],
      ) => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        fn(command, args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      }),
    });
  })(),
}));

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/pcc-agent-test",
  },
}));

function setPlatform(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(process, "arch", {
    value: arch,
    configurable: true,
  });
}

function restorePlatform(): void {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    configurable: true,
  });
  Object.defineProperty(process, "arch", {
    value: originalArch,
    configurable: true,
  });
}

async function loadModule() {
  vi.resetModules();
  return import("../agent-registry");
}

describe("getRegistryPlatformKeys", () => {
  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
    mockExecFile.mockReset();
  });

  it("uses Windows x64 registry targets on Windows x64", async () => {
    setPlatform("win32", "x64");
    const { getRegistryPlatformKeys } = await loadModule();

    expect(getRegistryPlatformKeys()).toEqual(["windows-x86_64"]);
  });

  it("does not expose Windows arm64 registry targets", async () => {
    setPlatform("win32", "arm64");
    const { getRegistryPlatformKeys } = await loadModule();

    expect(getRegistryPlatformKeys()).toEqual(["windows-x86_64"]);
  });

  it("keeps macOS arm64 registry targets", async () => {
    setPlatform("darwin", "arm64");
    const { getRegistryPlatformKeys } = await loadModule();

    expect(getRegistryPlatformKeys()).toEqual(["darwin-aarch64"]);
  });
});

describe("checkBinaries", () => {
  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
    mockExecFile.mockReset();
  });

  it("checks the Windows x64 binary target on Windows arm64", async () => {
    setPlatform("win32", "arm64");
    mockExecFile.mockImplementation(
      (command: string, args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        expect(command).toBe("where");
        expect(args).toEqual(["agent-x64"]);
        cb(null, "C:\\Tools\\agent-x64.exe\r\n", "");
      },
    );
    const { checkBinaries } = await loadModule();

    await expect(checkBinaries([
      {
        id: "agent",
        binary: {
          "windows-aarch64": { cmd: "agent-arm64" },
          "windows-x86_64": { cmd: "agent-x64", args: ["acp"] },
        },
      },
    ])).resolves.toEqual({
      agent: { path: "C:\\Tools\\agent-x64.exe", args: ["acp"] },
    });
  });
});
