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
  displayName: "claude-sonnet-4-6",
  description: "",
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

  it("uses only the DPCC catalog for active-session model queries", async () => {
    const supportedModels = vi.fn(async () => rawModels);
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

    expect(result).toEqual({ models: effectiveModels, authoritative: true });
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith([], expect.any(String));
    expect(supportedModels).not.toHaveBeenCalled();
    expect(mocks.getClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
  });

  it("does not read the SDK disk cache for DPCC cache queries", async () => {
    const result = await mocks.handlers.get("claude:models-cache:get")?.({});

    expect(result).toEqual({ models: effectiveModels, authoritative: true });
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith([], expect.any(String));
    expect(mocks.getClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
  });

  it("does not start an SDK model probe for DPCC revalidation", async () => {
    const result = await mocks.handlers.get("claude:models-cache:revalidate")?.(
      {},
      { cwd: "/tmp/project" },
    );

    expect(result).toEqual({ models: effectiveModels, authoritative: true });
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith([], expect.any(String));
    expect(mocks.getClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.getSDK).not.toHaveBeenCalled();
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
  });

  it("returns an empty structured result when DPCC catalog resolution fails", async () => {
    mocks.resolveEffectiveClaudeModelsResult.mockRejectedValue(new Error("resolver failed"));

    const result = await mocks.handlers.get("claude:models-cache:get")?.({});

    expect(result).toEqual({
      models: [],
      authoritative: false,
      error: "CLAUDE_MODEL_CATALOG_RESOLVE_ERR: Error: resolver failed",
    });
    expect(mocks.getClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.getSDK).not.toHaveBeenCalled();
  });

  it.each(["local", "gateway"] as const)(
    "keeps SDK supported models for %s mode",
    async (tier) => {
      mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream({
        tier,
        baseUrl: `https://${tier}.example`,
      }));
      mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
        models,
        authoritative: false,
      }));
      const supportedModels = vi.fn(async () => rawModels);
      const { sessions } = await import("./claude-sessions");
      sessions.set("session-1", {
        channel: {} as never,
        queryHandle: { supportedModels } as never,
        eventCounter: 0,
        pendingPermissions: new Map(),
      });

      const result = await mocks.handlers.get("claude:supported-models")?.({}, "session-1");

      expect(result).toEqual({ models: rawModels, authoritative: false });
      expect(supportedModels).toHaveBeenCalledTimes(1);
      expect(mocks.setClaudeModelsCache).toHaveBeenCalledWith(rawModels);
      expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith(
        rawModels,
        expect.any(String),
      );
    },
  );

  it.each(["local", "gateway"] as const)(
    "keeps the persisted SDK fallback when %s returns an empty live list",
    async (tier) => {
      mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream({
        tier,
        baseUrl: `https://${tier}-empty.example`,
      }));
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
      expect(mocks.getClaudeModelsCache).toHaveBeenCalledTimes(1);
      expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    },
  );

  it.each(["local", "gateway"] as const)(
    "reads the persisted SDK cache for %s cache queries",
    async (tier) => {
      mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream({
        tier,
        baseUrl: `https://${tier}-cache.example`,
      }));
      mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
        models,
        authoritative: false,
      }));

      const result = await mocks.handlers.get("claude:models-cache:get")?.({});

      expect(result).toEqual({
        models: rawModels,
        updatedAt: 100,
        authoritative: false,
      });
      expect(mocks.getClaudeModelsCache).toHaveBeenCalledTimes(1);
      expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenCalledWith(
        rawModels,
        expect.any(String),
      );
    },
  );

  it.each(["local", "gateway"] as const)(
    "revalidates and persists SDK models for %s mode",
    async (tier) => {
      mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream({
        tier,
        baseUrl: `https://${tier}-revalidate.example`,
      }));
      mocks.resolveEffectiveClaudeModelsResult.mockImplementation(async (models) => ({
        models,
        authoritative: false,
      }));
      const close = vi.fn();
      const supportedModels = vi.fn(async () => rawModels);
      mocks.getSDK.mockResolvedValue(() => ({ supportedModels, close }));

      const result = await mocks.handlers.get("claude:models-cache:revalidate")?.(
        {},
        { cwd: "/tmp/project" },
      );

      expect(result).toEqual({
        models: rawModels,
        updatedAt: 200,
        authoritative: false,
      });
      expect(mocks.getClaudeModelsCache).toHaveBeenCalledTimes(1);
      expect(mocks.setClaudeModelsCache).toHaveBeenCalledWith(rawModels);
      expect(supportedModels).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalled();
    },
  );

  it("does not cache an in-flight SDK result after switching to DPCC", async () => {
    let upstream = defaultUpstream({
      tier: "local",
      baseUrl: "https://local-switch.example",
    });
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    let resolveModels!: (models: typeof rawModels) => void;
    const supportedModels = vi.fn(
      () => new Promise<typeof rawModels>((resolve) => { resolveModels = resolve; }),
    );
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: {} as never,
      queryHandle: { supportedModels } as never,
      eventCounter: 0,
      pendingPermissions: new Map(),
    });

    const resultPromise = mocks.handlers.get("claude:supported-models")?.({}, "session-1");
    await vi.waitFor(() => expect(supportedModels).toHaveBeenCalledTimes(1));
    upstream = defaultUpstream();
    resolveModels(rawModels);

    await expect(resultPromise).resolves.toEqual({
      models: effectiveModels,
      authoritative: true,
    });
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenLastCalledWith(
      [],
      expect.any(String),
    );
  });

  it("does not start a second SDK probe after revalidation switches to DPCC", async () => {
    let upstream = defaultUpstream({
      tier: "local",
      baseUrl: "https://local-revalidate-switch.example",
    });
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    let resolveModels!: (models: typeof rawModels) => void;
    const close = vi.fn();
    const supportedModels = vi.fn(
      () => new Promise<typeof rawModels>((resolve) => { resolveModels = resolve; }),
    );
    const query = vi.fn(() => ({ supportedModels, close }));
    mocks.getSDK.mockResolvedValue(query);

    const resultPromise = mocks.handlers.get("claude:models-cache:revalidate")?.(
      {},
      { cwd: "/tmp/project" },
    );
    await vi.waitFor(() => expect(supportedModels).toHaveBeenCalledTimes(1));
    upstream = defaultUpstream();
    resolveModels(rawModels);

    await expect(resultPromise).resolves.toEqual({
      models: effectiveModels,
      authoritative: true,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(mocks.setClaudeModelsCache).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveClaudeModelsResult).toHaveBeenLastCalledWith(
      [],
      expect.any(String),
    );
    expect(close).toHaveBeenCalled();
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
    const query = vi.fn(() => ({ close: vi.fn(), async *[Symbol.asyncIterator]() {} }));
    const { sessions } = await import("./claude-sessions");
    sessions.set("session-1", {
      channel: { close: vi.fn() } as never,
      queryHandle: { close: vi.fn() } as never,
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await mocks.handlers.get("claude:stop")?.({}, "session-1")).toEqual({ ok: true });
    expect(query).not.toHaveBeenCalled();

    resolveSdk(query);

    await expect(switching).resolves.toEqual({ error: "Session restart cancelled" });
    expect(query).not.toHaveBeenCalled();
    expect(sessions.get("session-1")?.stopping).toBe(true);
  });
});
