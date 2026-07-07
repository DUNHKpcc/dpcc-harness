import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadLocalClaudeEnv,
  mockClientAppEnv,
  mockResolveClaudeUpstream,
  mockEnsureClaudeCodeGitBashEnv,
  mockPrepareClaudeCodeGitBashEnv,
} = vi.hoisted(() => ({
  mockLoadLocalClaudeEnv: vi.fn(),
  mockClientAppEnv: vi.fn(),
  mockResolveClaudeUpstream: vi.fn(),
  mockEnsureClaudeCodeGitBashEnv: vi.fn((env) => ({
    ...env,
    CLAUDE_CODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe",
  })),
  mockPrepareClaudeCodeGitBashEnv: vi.fn(async (env) => ({
    ...env,
    CLAUDE_CODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe",
  })),
}));

vi.mock("../local-cli-config", () => ({
  loadLocalClaudeEnv: mockLoadLocalClaudeEnv,
}));

vi.mock("../sdk", () => ({
  clientAppEnv: mockClientAppEnv,
}));

vi.mock("../upstream-resolver", () => ({
  resolveClaudeUpstream: mockResolveClaudeUpstream,
}));

vi.mock("../claude-git-bash", () => ({
  ensureClaudeCodeGitBashEnv: mockEnsureClaudeCodeGitBashEnv,
  prepareClaudeCodeGitBashEnv: mockPrepareClaudeCodeGitBashEnv,
}));

async function loadModule() {
  vi.resetModules();
  return import("../claude-gateway-env");
}

describe("claude gateway env", () => {
  beforeEach(() => {
    mockLoadLocalClaudeEnv.mockReset();
    mockClientAppEnv.mockReset();
    mockResolveClaudeUpstream.mockReset();
    mockEnsureClaudeCodeGitBashEnv.mockClear();
    mockPrepareClaudeCodeGitBashEnv.mockClear();

    mockLoadLocalClaudeEnv.mockReturnValue({});
    mockClientAppEnv.mockReturnValue({});
    mockResolveClaudeUpstream.mockReturnValue({
      tier: "default",
      baseUrl: "https://api.dpcc.example",
      token: "sk-dpcc",
      model: "",
    });
  });

  it("clears stale picker models when a resolved upstream has no configured model", async () => {
    const { claudeResolvedModel } = await loadModule();

    expect(claudeResolvedModel("deepseek-v4-pro")).toBeUndefined();
  });

  it("purges local Claude default model env when a gateway upstream is active", async () => {
    mockLoadLocalClaudeEnv.mockReturnValue({
      ANTHROPIC_BASE_URL: "https://local.example",
      ANTHROPIC_AUTH_TOKEN: "sk-local",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "deepseek-v4-pro",
      KEEP_ME: "1",
    });
    const { prepareClaudeSpawnEnv } = await loadModule();

    const env = await prepareClaudeSpawnEnv();

    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.dpcc.example");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-dpcc");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBeUndefined();
    expect(env.KEEP_ME).toBe("1");
  });

  it("strips macOS app identity env from Claude subprocesses", async () => {
    mockLoadLocalClaudeEnv.mockReturnValue({
      __CFBundleIdentifier: "com.pccagent.app",
      XPC_FLAGS: "0x0",
      XPC_SERVICE_NAME: "application.com.pccagent.app.123",
      KEEP_ME: "1",
    });
    const { prepareClaudeSpawnEnv } = await loadModule();

    const env = await prepareClaudeSpawnEnv();

    expect(env.__CFBundleIdentifier).toBeUndefined();
    expect(env.XPC_FLAGS).toBeUndefined();
    expect(env.XPC_SERVICE_NAME).toBeUndefined();
    expect(env.KEEP_ME).toBe("1");
  });

  it("adds Windows Git Bash discovery env to Claude subprocesses", async () => {
    mockLoadLocalClaudeEnv.mockReturnValue({
      KEEP_ME: "1",
    });
    const { prepareClaudeSpawnEnv } = await loadModule();

    const env = await prepareClaudeSpawnEnv();

    expect(mockPrepareClaudeCodeGitBashEnv).toHaveBeenCalledWith(expect.objectContaining({
      KEEP_ME: "1",
    }), undefined);
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("disables the user settings source when a gateway upstream is active", async () => {
    const { claudeSettingSources } = await loadModule();

    expect(claudeSettingSources()).toEqual(["project", "local"]);
  });

  it("keeps normal setting sources for local Claude upstream", async () => {
    mockResolveClaudeUpstream.mockReturnValue({
      tier: "local",
      baseUrl: "",
      token: "",
      model: "",
    });
    const { claudeSettingSources } = await loadModule();

    expect(claudeSettingSources()).toEqual(["user", "project", "local"]);
  });

  it("keeps local Claude env when the local upstream is selected", async () => {
    mockLoadLocalClaudeEnv.mockReturnValue({
      ANTHROPIC_BASE_URL: "https://local.example",
      ANTHROPIC_AUTH_TOKEN: "sk-local",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "local-sonnet",
      KEEP_ME: "1",
    });
    mockResolveClaudeUpstream.mockReturnValue({
      tier: "local",
      baseUrl: "https://local.example",
      token: "sk-local",
      model: "local-sonnet",
    });
    const { prepareClaudeSpawnEnv } = await loadModule();

    const env = await prepareClaudeSpawnEnv();

    expect(env.ANTHROPIC_BASE_URL).toBe("https://local.example");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-local");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("local-sonnet");
    expect(env.KEEP_ME).toBe("1");
  });

  it("uses the resolved upstream model when configured", async () => {
    mockResolveClaudeUpstream.mockReturnValue({
      tier: "default",
      baseUrl: "https://api.dpcc.example",
      token: "sk-dpcc",
      model: "claude-sonnet-4-6",
    });
    const { claudeResolvedModel } = await loadModule();

    expect(claudeResolvedModel("deepseek-v4-pro")).toBe("claude-sonnet-4-6");
  });

  it("does not expose the legacy synchronous spawn env helper", async () => {
    const module = await loadModule();

    expect(module).not.toHaveProperty("claudeSpawnEnv");
  });
});

describe("Claude Code Git Bash env discovery", () => {
  async function loadActualGitBashModule() {
    return vi.importActual<typeof import("../claude-git-bash")>("../claude-git-bash");
  }

  it("does not resolve Git Bash on non-Windows platforms", async () => {
    const { resolveClaudeCodeGitBashPath } = await loadActualGitBashModule();

    expect(
      resolveClaudeCodeGitBashPath(
        { ProgramFiles: "C:\\Program Files" },
        "darwin",
        () => true,
      ),
    ).toBeUndefined();
  });

  it("preserves an explicit CLAUDE_CODE_GIT_BASH_PATH", async () => {
    const {
      CLAUDE_CODE_GIT_BASH_PATH,
      resolveClaudeCodeGitBashPath,
      withClaudeCodeGitBashEnv,
    } = await loadActualGitBashModule();
    const env = {
      [CLAUDE_CODE_GIT_BASH_PATH]: "D:\\PortableGit\\bin\\bash.exe",
      ProgramFiles: "C:\\Program Files",
    };

    expect(resolveClaudeCodeGitBashPath(env, "win32", () => true)).toBe("D:\\PortableGit\\bin\\bash.exe");
    expect(withClaudeCodeGitBashEnv(env, "win32", () => true)).toBe(env);
  });

  it("finds Git Bash in common Windows install locations", async () => {
    const { resolveClaudeCodeGitBashPath } = await loadActualGitBashModule();
    const existsSync = vi.fn((candidate: string) => candidate === "C:\\Program Files\\Git\\bin\\bash.exe");

    expect(
      resolveClaudeCodeGitBashPath(
        { ProgramFiles: "C:\\Program Files" },
        "win32",
        existsSync,
      ),
    ).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("finds bash.exe from the Windows PATH when Git is installed elsewhere", async () => {
    const { resolveClaudeCodeGitBashPath } = await loadActualGitBashModule();
    const existsSync = vi.fn((candidate: string) => candidate === "D:\\Git\\bin\\bash.exe");

    expect(
      resolveClaudeCodeGitBashPath(
        { Path: "C:\\Windows\\System32;D:\\Git\\bin" },
        "win32",
        existsSync,
      ),
    ).toBe("D:\\Git\\bin\\bash.exe");
  });

  it("finds Git Bash when Windows PATH points at Git cmd", async () => {
    const { resolveClaudeCodeGitBashPath } = await loadActualGitBashModule();
    const existsSync = vi.fn((candidate: string) => candidate === "D:\\Tools\\Git\\bin\\bash.exe");

    expect(
      resolveClaudeCodeGitBashPath(
        { Path: "C:\\Windows\\System32;D:\\Tools\\Git\\cmd" },
        "win32",
        existsSync,
      ),
    ).toBe("D:\\Tools\\Git\\bin\\bash.exe");
  });

  it("prefers system Git Bash over managed PortableGit", async () => {
    const { resolveClaudeCodeGitBashPath } = await loadActualGitBashModule();
    const systemGit = "C:\\Program Files\\Git\\bin\\bash.exe";
    const managedGit = "C:\\Users\\tester\\AppData\\Roaming\\PccAgent\\pcc-agent-data\\git\\portable-git\\win32-x64\\bin\\bash.exe";
    const existsSync = vi.fn((candidate: string) => candidate === systemGit || candidate === managedGit);

    expect(
      resolveClaudeCodeGitBashPath(
        {
          ProgramFiles: "C:\\Program Files",
          Path: "C:\\Windows\\System32",
        },
        "win32",
        existsSync,
        { userDataPath: "C:\\Users\\tester\\AppData\\Roaming\\PccAgent" },
      ),
    ).toBe(systemGit);
  });

  it("uses managed PortableGit when system Git Bash is absent", async () => {
    const { resolveClaudeCodeGitBashPath } = await loadActualGitBashModule();
    const managedGit = "C:\\Users\\tester\\AppData\\Roaming\\PccAgent\\pcc-agent-data\\git\\portable-git\\win32-x64\\bin\\bash.exe";
    const existsSync = vi.fn((candidate: string) => candidate === managedGit);

    expect(
      resolveClaudeCodeGitBashPath(
        { Path: "C:\\Windows\\System32" },
        "win32",
        existsSync,
        { userDataPath: "C:\\Users\\tester\\AppData\\Roaming\\PccAgent" },
      ),
    ).toBe(managedGit);
  });

  it("extracts bundled PortableGit when Windows has no system or managed Git Bash", async () => {
    const { prepareClaudeCodeGitBashEnv } = await loadActualGitBashModule();
    const bundledArchive = "D:\\PccAgent\\resources\\portable-git\\win32-x64\\PortableGit-2.55.0.2-64-bit.7z.exe";
    const managedRoot = "C:\\Users\\tester\\AppData\\Roaming\\PccAgent\\pcc-agent-data\\git\\portable-git\\win32-x64";
    const managedGit = `${managedRoot}\\bin\\bash.exe`;
    let extracted = false;
    const existsSync = vi.fn((candidate: string) => {
      if (candidate === bundledArchive) return true;
      if (candidate === managedGit) return extracted;
      return false;
    });
    const extractPortableGitArchive = vi.fn(async (archivePath: string, destinationDir: string) => {
      expect(archivePath).toBe(bundledArchive);
      expect(destinationDir).toBe(managedRoot);
      extracted = true;
    });

    await expect(
      prepareClaudeCodeGitBashEnv(
        { Path: "C:\\Windows\\System32" },
        {
          platform: "win32",
          resourcesPath: "D:\\PccAgent\\resources",
          userDataPath: "C:\\Users\\tester\\AppData\\Roaming\\PccAgent",
          existsSync,
          extractPortableGitArchive,
        },
      ),
    ).resolves.toEqual({
      Path: "C:\\Windows\\System32",
      CLAUDE_CODE_GIT_BASH_PATH: managedGit,
    });
    expect(extractPortableGitArchive).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent bundled PortableGit extraction", async () => {
    const { prepareClaudeCodeGitBashEnv } = await loadActualGitBashModule();
    const bundledArchive = "D:\\PccAgent\\resources\\portable-git\\win32-x64\\PortableGit-2.55.0.2-64-bit.7z.exe";
    const managedRoot = "C:\\Users\\tester\\AppData\\Roaming\\PccAgent\\pcc-agent-data\\git\\portable-git\\win32-x64";
    const managedGit = `${managedRoot}\\bin\\bash.exe`;
    let extracted = false;
    let releaseExtraction: (() => void) | undefined;
    let markExtractionStarted: (() => void) | undefined;
    const extractionActuallyStarted = new Promise<void>((resolve) => {
      markExtractionStarted = resolve;
    });
    const releaseExtractionPromise = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const existsSync = vi.fn((candidate: string) => {
      if (candidate === bundledArchive) return true;
      if (candidate === managedGit) return extracted;
      return false;
    });
    const extractPortableGitArchive = vi.fn(async () => {
      markExtractionStarted?.();
      await releaseExtractionPromise;
      extracted = true;
    });

    const options = {
      platform: "win32" as const,
      resourcesPath: "D:\\PccAgent\\resources",
      userDataPath: "C:\\Users\\tester\\AppData\\Roaming\\PccAgent",
      existsSync,
      extractPortableGitArchive,
    };
    const first = prepareClaudeCodeGitBashEnv({ Path: "C:\\Windows\\System32" }, options);
    const second = prepareClaudeCodeGitBashEnv({ Path: "C:\\Windows\\System32" }, options);

    await extractionActuallyStarted;
    releaseExtraction?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { Path: "C:\\Windows\\System32", CLAUDE_CODE_GIT_BASH_PATH: managedGit },
      { Path: "C:\\Windows\\System32", CLAUDE_CODE_GIT_BASH_PATH: managedGit },
    ]);
    expect(extractPortableGitArchive).toHaveBeenCalledTimes(1);
  });

  it("adds CLAUDE_CODE_GIT_BASH_PATH when Git Bash is discoverable", async () => {
    const { ensureClaudeCodeGitBashEnv } = await loadActualGitBashModule();
    const env = { ProgramFiles: "C:\\Program Files", KEEP_ME: "1" };
    const existsSync = vi.fn((candidate: string) => candidate === "C:\\Program Files\\Git\\bin\\bash.exe");

    expect(ensureClaudeCodeGitBashEnv(env, "win32", existsSync)).toEqual({
      ProgramFiles: "C:\\Program Files",
      KEEP_ME: "1",
      CLAUDE_CODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe",
    });
  });

  it("throws a clear setup error when Windows has no Git Bash", async () => {
    const { ensureClaudeCodeGitBashEnv } = await loadActualGitBashModule();

    expect(() => ensureClaudeCodeGitBashEnv({ Path: "C:\\Windows\\System32" }, "win32", () => false))
      .toThrow(/Claude Code on Windows requires Git Bash/);
    expect(() => ensureClaudeCodeGitBashEnv({ Path: "C:\\Windows\\System32" }, "win32", () => false))
      .toThrow(/CLAUDE_CODE_GIT_BASH_PATH/);
  });

  it("reports Git Bash readiness for settings UI", async () => {
    const { getClaudeCodeGitBashStatus } = await loadActualGitBashModule();

    expect(getClaudeCodeGitBashStatus({ Path: "C:\\Windows\\System32" }, "win32", () => false)).toEqual({
      required: true,
      ready: false,
      path: null,
      message: expect.stringMatching(/CLAUDE_CODE_GIT_BASH_PATH/),
    });
  });
});
