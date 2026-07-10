import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveCodexUpstream,
  mockFetchUpstreamModels,
} = vi.hoisted(() => ({
  mockResolveCodexUpstream: vi.fn(),
  mockFetchUpstreamModels: vi.fn(),
}));

vi.mock("../upstream-resolver", () => ({
  resolveCodexUpstream: mockResolveCodexUpstream,
}));

vi.mock("../upstream-models", () => ({
  fetchUpstreamModels: mockFetchUpstreamModels,
}));

async function loadModule() {
  vi.resetModules();
  return import("../codex-upstream");
}

describe("codexUpstreamThreadParams", () => {
  beforeEach(() => {
    mockResolveCodexUpstream.mockReset();
  });

  it("uses the selected model fallback when non-local upstream config has no model", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "",
    });
    const { codexUpstreamThreadParams } = await loadModule();

    expect(codexUpstreamThreadParams("dpcc-default-model")).toMatchObject({
      modelProvider: "pcc-agent-gateway",
      model: "dpcc-default-model",
      config: expect.objectContaining({
        model_provider: "pcc-agent-gateway",
        model: "dpcc-default-model",
      }),
    });
  });

  it("prefers the composer-selected model over the configured upstream default", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "configured-default",
    });
    const { codexUpstreamThreadParams } = await loadModule();

    expect(codexUpstreamThreadParams("composer-selected")).toMatchObject({
      model: "composer-selected",
      config: expect.objectContaining({ model: "composer-selected" }),
    });
  });

  it("omits model instead of passing null when neither config nor fallback provides one", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "gateway",
      providerName: "Gateway Provider",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-gateway",
      model: "",
    });
    const { codexUpstreamThreadParams } = await loadModule();

    const params = codexUpstreamThreadParams();

    expect(params).toMatchObject({
      modelProvider: "pcc-agent-gateway",
      config: expect.objectContaining({
        model_provider: "pcc-agent-gateway",
      }),
    });
    expect(params).not.toHaveProperty("model");
    expect(params.config).not.toHaveProperty("model");
  });
});

describe("DPCC Codex model catalog", () => {
  beforeEach(() => {
    mockResolveCodexUpstream.mockReset();
    mockFetchUpstreamModels.mockReset();
  });

  it("uses DPCC model ids as the authoritative set while preserving native metadata", async () => {
    const nativeModels = [
      {
        id: "native-supported",
        model: "native-supported",
        upgrade: null,
        displayName: "Native Supported",
        description: "Native metadata",
        hidden: false,
        supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
        defaultReasoningEffort: "high",
        inputModalities: ["text"],
        supportsPersonality: true,
        isDefault: false,
      },
      {
        id: "native-unavailable",
        model: "native-unavailable",
        upgrade: null,
        displayName: "Native Unavailable",
        description: "Must be filtered out",
        hidden: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: "medium",
        inputModalities: ["text"],
        supportsPersonality: false,
        isDefault: true,
      },
    ];

    const { mergeCodexModelsForUpstream, resolveCodexReasoningEffort } = await import("@shared/lib/codex-helpers");
    const models = mergeCodexModelsForUpstream(
      nativeModels as never[],
      ["dpcc-new", "native-supported", "dpcc-new"],
      "dpcc-new",
    );

    expect(models.map((model) => model.id)).toEqual(["dpcc-new", "native-supported"]);
    expect(models[0]).toMatchObject({
      id: "dpcc-new",
      displayName: "dpcc-new",
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [],
      isDefault: true,
    });
    expect(models[1]).toMatchObject({
      displayName: "Native Supported",
      description: "Native metadata",
      defaultReasoningEffort: "high",
      isDefault: false,
    });
    expect(resolveCodexReasoningEffort(models[0], "medium")).toBeUndefined();
    expect(resolveCodexReasoningEffort(models[1], "medium")).toBe("high");
    expect(resolveCodexReasoningEffort(undefined, "medium")).toBeUndefined();
  });

  it("treats spark as a synthesized upstream-only model with no reasoning effort options", async () => {
    const nativeModels = [{ id: "another-native", isDefault: false }];

    const { mergeCodexModelsForUpstream, resolveCodexReasoningEffort } = await import("@shared/lib/codex-helpers");
    const [spark] = mergeCodexModelsForUpstream(nativeModels as never[], ["gpt-5.3-codex-spark"], "gpt-5.3-codex-spark");

    expect(spark).toMatchObject({
      id: "gpt-5.3-codex-spark",
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [],
    });
    expect(resolveCodexReasoningEffort(spark, "medium")).toBeUndefined();
  });

  it("fetches and caches DPCC ids but leaves local Codex catalogs unchanged", async () => {
    const nativeModels = [{ id: "native", displayName: "Native", isDefault: true }];
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "dpcc-new",
    });
    mockFetchUpstreamModels.mockResolvedValue({ models: ["dpcc-new"], error: null });

    const { clearCodexModelCatalogCache, resolveEffectiveCodexModels } = await import("../codex-model-catalog");
    clearCodexModelCatalogCache();
    const first = await resolveEffectiveCodexModels(nativeModels as never[]);
    const second = await resolveEffectiveCodexModels(nativeModels as never[]);

    expect(first.map((model) => model.id)).toEqual(["dpcc-new"]);
    expect(second.map((model) => model.id)).toEqual(["dpcc-new"]);
    expect(mockFetchUpstreamModels).toHaveBeenCalledTimes(1);

    mockResolveCodexUpstream.mockReturnValue({
      tier: "local",
      providerName: "local",
      baseUrl: "",
      apiKey: "",
      model: "native",
    });
    expect(await resolveEffectiveCodexModels(nativeModels as never[])).toBe(nativeModels);
  });

  it("falls back to the native catalog when DPCC model loading fails", async () => {
    const nativeModels = [{ id: "native", displayName: "Native", isDefault: true }];
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "",
    });
    mockFetchUpstreamModels.mockResolvedValue({ models: [], error: "503" });

    const { clearCodexModelCatalogCache, resolveEffectiveCodexModels } = await import("../codex-model-catalog");
    clearCodexModelCatalogCache();

    expect(await resolveEffectiveCodexModels(nativeModels as never[])).toBe(nativeModels);
  });

  it("uses the last successful DPCC catalog when refresh fails", async () => {
    const nativeModels = [{ id: "native", displayName: "Native", isDefault: true }];
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "",
    });
    mockFetchUpstreamModels
      .mockResolvedValueOnce({ models: ["dpcc-stable"], error: null })
      .mockResolvedValueOnce({ models: [], error: "503" });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const { clearCodexModelCatalogCache, resolveEffectiveCodexModels } = await import("../codex-model-catalog");
    clearCodexModelCatalogCache();
    expect((await resolveEffectiveCodexModels(nativeModels as never[])).map((model) => model.id))
      .toEqual(["dpcc-stable"]);

    now.mockReturnValue(62_000);
    expect((await resolveEffectiveCodexModels(nativeModels as never[])).map((model) => model.id))
      .toEqual(["dpcc-stable"]);
    expect(mockFetchUpstreamModels).toHaveBeenCalledTimes(2);
  });

  it("keeps stale catalogs isolated by upstream fingerprint", async () => {
    const nativeModels = [{ id: "native", displayName: "Native", isDefault: true }];
    const upstreamA = {
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api-a.dpcc.example/v1",
      apiKey: "sk-a",
      model: "",
    };
    const upstreamB = { ...upstreamA, baseUrl: "https://api-b.dpcc.example/v1", apiKey: "sk-b" };
    mockResolveCodexUpstream.mockReturnValue(upstreamA);
    mockFetchUpstreamModels
      .mockResolvedValueOnce({ models: ["dpcc-a"], error: null })
      .mockResolvedValueOnce({ models: ["dpcc-b"], error: null })
      .mockResolvedValueOnce({ models: [], error: "503" });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);

    const { clearCodexModelCatalogCache, resolveEffectiveCodexModels } = await import("../codex-model-catalog");
    clearCodexModelCatalogCache();
    expect((await resolveEffectiveCodexModels(nativeModels as never[])).map((model) => model.id))
      .toEqual(["dpcc-a"]);

    mockResolveCodexUpstream.mockReturnValue(upstreamB);
    expect((await resolveEffectiveCodexModels(nativeModels as never[])).map((model) => model.id))
      .toEqual(["dpcc-b"]);

    now.mockReturnValue(62_000);
    mockResolveCodexUpstream.mockReturnValue(upstreamA);
    expect((await resolveEffectiveCodexModels(nativeModels as never[])).map((model) => model.id))
      .toEqual(["dpcc-a"]);
  });

  it("keeps an empty successful DPCC response authoritative", async () => {
    const nativeModels = [{ id: "native", displayName: "Native", isDefault: true }];
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "",
    });
    mockFetchUpstreamModels.mockResolvedValue({ models: [], error: null });

    const { clearCodexModelCatalogCache, resolveEffectiveCodexModels } = await import("../codex-model-catalog");
    clearCodexModelCatalogCache();

    expect(await resolveEffectiveCodexModels(nativeModels as never[])).toEqual([]);
  });
});
