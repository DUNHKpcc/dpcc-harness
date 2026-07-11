import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  resolveEffectiveClaudeModels: vi.fn(),
  resolveEffectiveClaudeModelsResult: vi.fn(),
  resolveClaudeModelForRequest: vi.fn(),
  claudeUpstreamFingerprint: vi.fn((upstream: unknown) => JSON.stringify(upstream)),
  getClaudeModelsCache: vi.fn(),
  setClaudeModelsCache: vi.fn(),
  getSDK: vi.fn(),
  getCliPath: vi.fn(),
  getClaudeBinaryMetadata: vi.fn(),
  reportError: vi.fn(),
  resolveClaudeUpstream: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", getVersion: () => "1.0.0" },
  BrowserWindow: class {},
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<any>) => {
      mocks.handlers.set(channel, handler);
    },
    on: vi.fn(),
  },
}));

vi.mock("../lib/sdk", () => ({
  getSDK: mocks.getSDK,
  getCliPath: mocks.getCliPath,
}));

vi.mock("../lib/claude-model-cache", () => ({
  getClaudeModelsCache: mocks.getClaudeModelsCache,
  setClaudeModelsCache: mocks.setClaudeModelsCache,
}));

vi.mock("../lib/claude-model-catalog", () => ({
  claudeUpstreamFingerprint: mocks.claudeUpstreamFingerprint,
  resolveClaudeModelForRequest: mocks.resolveClaudeModelForRequest,
  resolveEffectiveClaudeModels: mocks.resolveEffectiveClaudeModels,
  resolveEffectiveClaudeModelsResult: mocks.resolveEffectiveClaudeModelsResult,
}));

vi.mock("../lib/upstream-resolver", () => ({
  resolveClaudeUpstream: mocks.resolveClaudeUpstream,
}));

vi.mock("../lib/async-channel", () => ({
  AsyncChannel: class {
    close = vi.fn();
    push = vi.fn();
  },
}));

vi.mock("../lib/claude-binary", () => ({
  downloadClaudeUpdate: vi.fn(),
  getClaudeBinaryInfo: vi.fn(),
  getClaudeBinaryMetadata: mocks.getClaudeBinaryMetadata,
  getClaudeBinaryPath: vi.fn(),
  getClaudeSdkProcessOptions: vi.fn(() => ({ env: {} })),
  getClaudeBinaryStatus: vi.fn(),
  getClaudeVersion: vi.fn(),
}));

vi.mock("../lib/claude-gateway-env", () => ({
  prepareClaudeSpawnEnv: vi.fn(async () => ({})),
  claudeResolvedModel: vi.fn((model: string | undefined) => model),
  claudeSettingSources: vi.fn(() => []),
}));

vi.mock("../lib/error-utils", () => ({
  reportError: mocks.reportError,
}));

vi.mock("../lib/logger", () => ({ log: vi.fn() }));
vi.mock("../lib/safe-send", () => ({ safeSend: vi.fn() }));
vi.mock("../lib/mcp-oauth-flow", () => ({ getMcpAuthHeaders: vi.fn() }));
vi.mock("../lib/claude-codex-bridge-controller", () => ({ getClaudeCodexBridgeController: vi.fn() }));
vi.mock("../lib/claude-mcp-isolation", () => ({ applyClaudeMcpIsolation: vi.fn() }));
vi.mock("../lib/macos-dock-focus", () => ({ reclaimMacDockFocus: vi.fn() }));
vi.mock("../lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("../lib/session-cwd", () => ({ normalizeSessionCwd: (cwd: string | undefined) => cwd }));
vi.mock("@shared/lib/mcp-config", () => ({ buildSdkMcpConfig: vi.fn() }));
vi.mock("@shared/lib/claude-codex-bridge", () => ({ appendClaudeCodexBridgeServer: vi.fn() }));

const rawModels = [{
  value: "sonnet",
  displayName: "Sonnet",
  description: "Raw SDK metadata",
}];

const effectiveModels = [{
  value: "claude-sonnet-4-6",
  displayName: "Sonnet",
  description: "Raw SDK metadata",
}];

const defaultUpstream = (overrides: Partial<{
  tier: "default" | "gateway" | "local";
  baseUrl: string;
  token: string;
  model: string;
}> = {}) => ({
  tier: "default" as const,
  baseUrl: "https://api.dpcc.example",
  token: "token-a",
  model: "claude-sonnet-4-6",
  ...overrides,
});

describe("Claude model IPC catalog", () => {
  beforeEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    mocks.handlers.clear();
    mocks.resolveEffectiveClaudeModels.mockReset();
    mocks.resolveEffectiveClaudeModelsResult.mockReset();
    mocks.resolveClaudeModelForRequest.mockReset();
    mocks.claudeUpstreamFingerprint.mockClear();
    mocks.getClaudeModelsCache.mockReset();
    mocks.setClaudeModelsCache.mockReset();
    mocks.getSDK.mockReset();
    mocks.getCliPath.mockReset();
    mocks.getClaudeBinaryMetadata.mockReset();
    mocks.reportError.mockReset();
    mocks.resolveClaudeUpstream.mockReset();

    mocks.resolveEffectiveClaudeModels.mockResolvedValue(effectiveModels);
    mocks.resolveEffectiveClaudeModelsResult.mockResolvedValue({
      models: effectiveModels,
      authoritative: true,
    });
    mocks.resolveClaudeModelForRequest.mockImplementation(async (model) => model);
    mocks.getClaudeModelsCache.mockReturnValue({ models: rawModels, updatedAt: 100 });
    mocks.setClaudeModelsCache.mockImplementation((models) => ({ models, updatedAt: 200 }));
    mocks.reportError.mockImplementation((code: string, error: unknown) => `${code}: ${String(error)}`);
    mocks.getCliPath.mockReturnValue(undefined);
    mocks.getClaudeBinaryMetadata.mockReturnValue(undefined);
    mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream());

    const { register, sessions } = await import("./claude-sessions");
    sessions.clear();
    register(() => null);
  });

  it("caches the raw supported models while returning the effective catalog", async () => {
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels: vi.fn(async () => rawModels) } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(mocks.setClaudeModelsCache).toHaveBeenCalledWith(rawModels);
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith(rawModels, expect.any(String));
    expect(result).toEqual({ models: effectiveModels, authoritative: true });
  });

  it("restarts a live Claude transport before changing models after the upstream changes", async () => {
    let upstream = defaultUpstream({ tier: "local", baseUrl: "https://local.example" });
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    const close = vi.fn();
    const queryHandle = {
      close,
      async *[Symbol.asyncIterator]() {},
    };
    const query = vi.fn(() => queryHandle);
    mocks.getSDK.mockResolvedValue(query);
    mocks.resolveClaudeModelForRequest.mockResolvedValue("claude-sonnet-4-6");
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: { close: vi.fn() } as never,
      queryHandle: { close } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
      startOptions: { model: "glm-5.2" },
      upstreamFingerprint: JSON.stringify(upstream),
      upstreamTier: "local",
    });

    upstream = defaultUpstream({ model: "" });
    const result = await mocks.handlers.get("claude:set-model")?.({}, {
      sessionId: "session-1",
      model: "glm-5.2",
    });

    expect(result).toEqual({ ok: true, restarted: true });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ model: "claude-sonnet-4-6" }),
    }));
    expect(mocks.resolveClaudeModelForRequest).toHaveBeenCalledWith(undefined);
    expect(close).toHaveBeenCalled();
  });

  it("does not revive a session when stop cancels a queued upstream restart", async () => {
    let upstream = defaultUpstream({ tier: "local", baseUrl: "https://local.example" });
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    let resolveSdk!: (query: unknown) => void;
    mocks.getSDK.mockReturnValue(new Promise((resolve) => { resolveSdk = resolve; }));
    const close = vi.fn();
    const query = vi.fn(() => ({ close: vi.fn(), async *[Symbol.asyncIterator]() {} }));
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: { close: vi.fn() } as never,
      queryHandle: { close } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
      startOptions: { model: "glm-5.2" },
      upstreamFingerprint: JSON.stringify(upstream),
      upstreamTier: "local",
    });

    upstream = defaultUpstream({ model: "" });
    const switching = mocks.handlers.get("claude:set-model")?.({}, {
      sessionId: "session-1",
      model: "glm-5.2",
    });
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(await mocks.handlers.get("claude:stop")?.({}, "session-1")).toEqual({ ok: true });
    resolveSdk(query);

    await expect(switching).resolves.toEqual({ error: "Session restart cancelled" });
    expect(query).not.toHaveBeenCalled();
    expect(sessions.get("session-1")?.stopping).toBe(true);
  });

  it.each([
    ["source", defaultUpstream({ tier: "gateway", baseUrl: "https://gateway.example" })],
    ["credential", defaultUpstream({ token: "token-b" })],
    ["model", defaultUpstream({ model: "claude-opus-4-6" })],
  ] as const)("does not cache or apply active SDK metadata after a %s change", async (_kind, nextUpstream) => {
    let upstream = defaultUpstream();
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    let resolveModels!: (models: typeof rawModels) => void;
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: {
        supportedModels: vi.fn(() => new Promise<typeof rawModels>((resolve) => { resolveModels = resolve; })),
      } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const resultPromise = mocks.handlers.get("claude:supported-models")?.({}, "session-1");
    await vi.waitFor(() => {
      expect(sessions.get("session-1")?.queryHandle?.supportedModels).toHaveBeenCalledTimes(1);
    });
    upstream = nextUpstream;
    resolveModels(rawModels);

    mocks.resolveEffectiveClaudeModelsResult.mockResolvedValue({ models: effectiveModels, authoritative: false });
    await expect(resultPromise).resolves.toEqual({ models: effectiveModels, authoritative: false });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenLastCalledWith([], expect.any(String));
  });

  it("resolves an empty supported model list so DPCC ids can be synthesized", async () => {
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels: vi.fn(async () => []) } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith(rawModels, expect.any(String));
    expect(result).toEqual({ models: effectiveModels, authoritative: true });
  });

  it("preserves SDK metadata when DPCC resolution fails after an empty live SDK response", async () => {
    mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
      models,
      authoritative: false,
    }));
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels: vi.fn(async () => []) } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(result).toEqual({ models: rawModels, authoritative: false });
  });

  it.each(["local", "gateway"] as const)("keeps the existing SDK fallback when %s supported models are empty", async (tier) => {
    mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream({ tier }));
    mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
      models,
      authoritative: false,
    }));
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels: vi.fn(async () => []) } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(result).toEqual({ models: rawModels, authoritative: false });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
  });

  it("resolves the persisted raw cache while preserving updatedAt", async () => {
    const result = await mocks.handlers.get("claude:models-cache:get")?.({});

    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith(rawModels, expect.any(String));
    expect(result).toEqual({ models: effectiveModels, updatedAt: 100, authoritative: true });
  });

  it("returns the raw cache with a structured catalog error when cache resolution fails", async () => {
    mocks.resolveEffectiveClaudeModelsResult.mockRejectedValue(new Error("resolver failed"));

    const resultPromise = mocks.handlers.get("claude:models-cache:get")?.({});

    await expect(resultPromise).resolves.toEqual({
      models: rawModels,
      updatedAt: 100,
      authoritative: false,
      error: "CLAUDE_MODEL_CATALOG_RESOLVE_ERR: Error: resolver failed",
    });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith(
      "CLAUDE_MODEL_CATALOG_RESOLVE_ERR",
      expect.any(Error),
      { engine: "claude" },
    );
  });

  it("persists a revalidated raw SDK list while returning the effective catalog", async () => {
    const close = vi.fn();
    const supportedModels = vi.fn(async () => rawModels);
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));

    const result = await mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });

    expect(mocks.setClaudeModelsCache).toHaveBeenCalledWith(rawModels);
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith(rawModels, expect.any(String));
    expect(result).toEqual({ models: effectiveModels, updatedAt: 200, authoritative: true });
    expect(close).toHaveBeenCalled();
  });

  it("does not cache or apply revalidated SDK metadata after the source changes", async () => {
    let upstream = defaultUpstream();
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    let resolveModels!: (models: typeof rawModels) => void;
    const close = vi.fn();
    const supportedModels = vi
      .fn()
      .mockImplementationOnce(() => new Promise<typeof rawModels>((resolve) => { resolveModels = resolve; }))
      .mockResolvedValueOnce([]);
    mocks.getClaudeModelsCache.mockReturnValue({ models: [], updatedAt: 100 });
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));

    const resultPromise = mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });
    await vi.waitFor(() => {
      expect(supportedModels).toHaveBeenCalledTimes(1);
    });
    upstream = defaultUpstream({ tier: "gateway", baseUrl: "https://gateway.example" });
    mocks.resolveEffectiveClaudeModelsResult.mockResolvedValue({ models: effectiveModels, authoritative: false });
    resolveModels(rawModels);

    await expect(resultPromise).resolves.toEqual({ models: effectiveModels, updatedAt: 100, authoritative: false });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenLastCalledWith([], expect.any(String));
    expect(supportedModels).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalled();
  });

  it("resolves an empty revalidated SDK list without enriching it from the raw cache", async () => {
    const close = vi.fn();
    const supportedModels = vi.fn(async () => []);
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));

    const result = await mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });

    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith(rawModels, expect.any(String));
    expect(result).toEqual({ models: effectiveModels, updatedAt: 100, authoritative: true });
    expect(close).toHaveBeenCalled();
  });

  it("preserves SDK metadata when DPCC resolution fails after an empty revalidation", async () => {
    mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
      models,
      authoritative: false,
    }));
    const close = vi.fn();
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels: vi.fn(async () => []), close }));

    const result = await mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });

    expect(result).toEqual({ models: rawModels, updatedAt: 100, authoritative: false });
    expect(close).toHaveBeenCalled();
  });

  it.each(["local", "gateway"] as const)("keeps the existing SDK fallback when %s revalidation returns no models", async (tier) => {
    mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream({ tier }));
    mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
      models,
      authoritative: false,
    }));
    const close = vi.fn();
    const supportedModels = vi.fn(async () => []);
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));

    const result = await mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });

    expect(result).toEqual({ models: rawModels, updatedAt: 100, authoritative: false });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("revalidates the current source once after a shared in-flight request becomes stale", async () => {
    let upstream = defaultUpstream();
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    const close = vi.fn();
    let resolveFirst!: (models: typeof rawModels) => void;
    const firstSupportedModels = vi.fn(() => new Promise<typeof rawModels>((resolve) => { resolveFirst = resolve; }));
    const secondSupportedModels = vi.fn(async () => [{
      value: "gateway-sonnet",
      displayName: "Gateway Sonnet",
      description: "",
    }]);
    const query = vi
      .fn()
      .mockReturnValueOnce({ supportedModels: firstSupportedModels, close })
      .mockReturnValueOnce({ supportedModels: secondSupportedModels, close });
    mocks.getSDK.mockResolvedValue(query);
    mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
      models,
      authoritative: false,
    }));

    const first = mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });
    await vi.waitFor(() => {
      expect(firstSupportedModels).toHaveBeenCalledTimes(1);
    });
    upstream = defaultUpstream({ tier: "gateway", baseUrl: "https://gateway.example" });
    const second = mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });
    resolveFirst(rawModels);

    await vi.waitFor(() => {
      expect(secondSupportedModels).toHaveBeenCalledTimes(1);
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        models: [{ value: "gateway-sonnet", displayName: "Gateway Sonnet", description: "" }],
        updatedAt: 200,
        authoritative: false,
      },
      {
        models: [{ value: "gateway-sonnet", displayName: "Gateway Sonnet", description: "" }],
        updatedAt: 200,
        authoritative: false,
      },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not reuse an in-flight model request after the Claude binary changes", async () => {
    let binaryPath = "/old/claude";
    mocks.getClaudeBinaryMetadata.mockImplementation(() => ({
      path: binaryPath,
      source: "custom",
      strategy: "custom",
    }));
    const close = vi.fn();
    let resolveFirst!: (models: typeof rawModels) => void;
    const firstSupportedModels = vi.fn(() => new Promise<typeof rawModels>((resolve) => { resolveFirst = resolve; }));
    const freshModels = [{ value: "fresh", displayName: "Fresh", description: "" }];
    const secondSupportedModels = vi.fn(async () => freshModels);
    const query = vi
      .fn()
      .mockReturnValueOnce({ supportedModels: firstSupportedModels, close })
      .mockReturnValueOnce({ supportedModels: secondSupportedModels, close });
    mocks.getSDK.mockResolvedValue(query);
    mocks.setClaudeModelsCache.mockImplementation((models) => ({ models, updatedAt: 200 }));
    mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
      models,
      authoritative: false,
    }));

    const first = mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });
    await vi.waitFor(() => expect(firstSupportedModels).toHaveBeenCalledTimes(1));
    binaryPath = "/new/claude";
    const second = mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });
    resolveFirst(rawModels);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { models: freshModels, updatedAt: 200, authoritative: false },
      { models: freshModels, updatedAt: 200, authoritative: false },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("preserves a revalidation error when catalog resolution also fails", async () => {
    const close = vi.fn();
    const supportedModels = vi.fn(async () => {
      throw new Error("SDK failed");
    });
    mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));
    mocks.resolveEffectiveClaudeModelsResult.mockRejectedValue(new Error("resolver failed"));

    const resultPromise = mocks.handlers.get("claude:models-cache:revalidate")?.({}, { cwd: "/tmp/project" });

    await expect(resultPromise).resolves.toEqual({
      models: rawModels,
      updatedAt: 100,
      authoritative: false,
      error: "MODELS_CACHE_REVALIDATE_ERR: Error: SDK failed",
    });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith(
      "CLAUDE_MODEL_CATALOG_RESOLVE_ERR",
      expect.any(Error),
      { engine: "claude" },
    );
    expect(close).toHaveBeenCalled();
  });

  it("reports resolver failures without replacing the raw cache with effective models", async () => {
    const normalizedRawModels = [{
      value: "sonnet",
      displayName: "Sonnet",
      description: "",
    }];
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels: vi.fn(async () => rawModels) } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });
    mocks.setClaudeModelsCache.mockReturnValue({ models: normalizedRawModels, updatedAt: 200 });
    mocks.resolveEffectiveClaudeModelsResult.mockRejectedValue(new Error("resolver failed"));

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(mocks.setClaudeModelsCache).toHaveBeenCalledWith(rawModels);
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalledWith(effectiveModels);
    expect(mocks.reportError).toHaveBeenCalledWith(
      "SUPPORTED_MODELS_ERR",
      expect.any(Error),
      { engine: "claude", sessionId: "session-1" },
    );
    expect(result).toEqual({
      models: normalizedRawModels,
      authoritative: false,
      error: "SUPPORTED_MODELS_ERR: Error: resolver failed",
    });
  });
});
