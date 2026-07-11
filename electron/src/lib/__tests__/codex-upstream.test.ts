import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexModel, CodexModelCapability } from "@shared/types/codex";

const SPARK_MODEL_ID = "gpt-5.3-codex-spark";
const SPARK_CAPABILITY: CodexModelCapability = {
  supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  defaultReasoningEffort: "high",
};
const SPARK_CAPABILITIES: Readonly<Record<string, CodexModelCapability>> = {
  [SPARK_MODEL_ID]: SPARK_CAPABILITY,
};

function createCodexModel({
  id = "native",
  model = id,
  ...overrides
}: Partial<CodexModel> = {}): CodexModel {
  return {
    id,
    model,
    upgrade: null,
    displayName: id,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "none",
    inputModalities: ["text"],
    supportsPersonality: false,
    isDefault: false,
    ...overrides,
  };
}

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

async function loadCodexHelpers() {
  return import("@shared/lib/codex-helpers");
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
      createCodexModel({
        id: "native-supported",
        displayName: "Native Supported",
        description: "Native metadata",
        supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
        defaultReasoningEffort: "high",
        supportsPersonality: true,
        isDefault: false,
      }),
      createCodexModel({
        id: "native-unavailable",
        displayName: "Native Unavailable",
        description: "Must be filtered out",
        supportedReasoningEfforts: [],
        defaultReasoningEffort: "medium",
        supportsPersonality: false,
        isDefault: true,
      }),
    ];

    const { mergeCodexModelsForUpstream, resolveCodexReasoningEffort } = await loadCodexHelpers();
    const models = mergeCodexModelsForUpstream(
      nativeModels,
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

  it("uses upstream capabilities for an upstream-only Spark model", async () => {
    const { mergeCodexModelsForUpstream } = await loadCodexHelpers();
    const [spark] = mergeCodexModelsForUpstream(
      [],
      [SPARK_MODEL_ID],
      SPARK_MODEL_ID,
      SPARK_CAPABILITIES,
    );

    expect(spark).toMatchObject({
      id: "gpt-5.3-codex-spark",
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Low" },
        { reasoningEffort: "medium", description: "Medium" },
        { reasoningEffort: "high", description: "High" },
        { reasoningEffort: "xhigh", description: "Extra High" },
      ],
    });
  });

  it("preserves native Spark efforts when upstream capabilities differ", async () => {
    const nativeSpark = createCodexModel({
      id: SPARK_MODEL_ID,
      displayName: "Native Spark",
      description: "Native metadata",
      supportedReasoningEfforts: [{ reasoningEffort: "minimal", description: "Native Minimal" }],
      defaultReasoningEffort: "minimal",
      supportsPersonality: false,
      isDefault: false,
    });
    const { mergeCodexModelsForUpstream } = await loadCodexHelpers();
    const [spark] = mergeCodexModelsForUpstream(
      [nativeSpark],
      [SPARK_MODEL_ID],
      undefined,
      SPARK_CAPABILITIES,
    );

    expect(spark).toMatchObject({
      displayName: "Native Spark",
      description: "Native metadata",
      defaultReasoningEffort: "minimal",
      supportedReasoningEfforts: [{ reasoningEffort: "minimal", description: "Native Minimal" }],
    });
  });

  it("does not infer Spark capabilities for a different upstream model id", async () => {
    const { mergeCodexModelsForUpstream } = await loadCodexHelpers();
    const [sparkPreview] = mergeCodexModelsForUpstream(
      [],
      [`${SPARK_MODEL_ID}-preview`],
      undefined,
      SPARK_CAPABILITIES,
    );

    expect(sparkPreview).toMatchObject({
      id: `${SPARK_MODEL_ID}-preview`,
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [],
    });
  });

  it("falls back to the Spark capability default for an unsupported requested effort", async () => {
    const { mergeCodexModelsForUpstream, resolveCodexReasoningEffort } = await loadCodexHelpers();
    const [spark] = mergeCodexModelsForUpstream(
      [],
      [SPARK_MODEL_ID],
      undefined,
      SPARK_CAPABILITIES,
    );

    expect(resolveCodexReasoningEffort(spark, "minimal")).toBe("high");
  });

  it("uses the first supported upstream effort when no default is advertised", async () => {
    const { mergeCodexModelsForUpstream } = await loadCodexHelpers();
    const [spark] = mergeCodexModelsForUpstream(
      [],
      [SPARK_MODEL_ID],
      undefined,
      { [SPARK_MODEL_ID]: { supportedReasoningEfforts: ["medium", "high"] } },
    );

    expect(spark.defaultReasoningEffort).toBe("medium");
  });

  it("uses the first supported upstream effort when its advertised default is unsupported", async () => {
    const { mergeCodexModelsForUpstream } = await loadCodexHelpers();
    const [spark] = mergeCodexModelsForUpstream(
      [],
      [SPARK_MODEL_ID],
      undefined,
      {
        [SPARK_MODEL_ID]: {
          supportedReasoningEfforts: ["low", "medium"],
          defaultReasoningEffort: "high",
        },
      },
    );

    expect(spark.defaultReasoningEffort).toBe("low");
  });

  it("keeps empty upstream effort capabilities empty with a none default", async () => {
    const { mergeCodexModelsForUpstream } = await loadCodexHelpers();
    const [spark] = mergeCodexModelsForUpstream(
      [],
      [SPARK_MODEL_ID],
      undefined,
      { [SPARK_MODEL_ID]: { supportedReasoningEfforts: [] } },
    );

    expect(spark).toMatchObject({
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [],
    });
  });

  it("fetches and caches DPCC ids but leaves local Codex catalogs unchanged", async () => {
    const nativeModels = [createCodexModel({ displayName: "Native", isDefault: true })];
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
    const first = await resolveEffectiveCodexModels(nativeModels);
    const second = await resolveEffectiveCodexModels(nativeModels);

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
    expect(await resolveEffectiveCodexModels(nativeModels)).toBe(nativeModels);
  });

  it("falls back to the native catalog when DPCC model loading fails", async () => {
    const nativeModels = [createCodexModel({ displayName: "Native", isDefault: true })];
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

    expect(await resolveEffectiveCodexModels(nativeModels)).toBe(nativeModels);
  });

  it("uses the last successful DPCC catalog when refresh fails", async () => {
    const nativeModels = [createCodexModel({ displayName: "Native", isDefault: true })];
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
    expect((await resolveEffectiveCodexModels(nativeModels)).map((model) => model.id))
      .toEqual(["dpcc-stable"]);

    now.mockReturnValue(62_000);
    expect((await resolveEffectiveCodexModels(nativeModels)).map((model) => model.id))
      .toEqual(["dpcc-stable"]);
    expect(mockFetchUpstreamModels).toHaveBeenCalledTimes(2);
  });

  it("keeps stale catalogs isolated by upstream fingerprint", async () => {
    const nativeModels = [createCodexModel({ displayName: "Native", isDefault: true })];
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
    expect((await resolveEffectiveCodexModels(nativeModels)).map((model) => model.id))
      .toEqual(["dpcc-a"]);

    mockResolveCodexUpstream.mockReturnValue(upstreamB);
    expect((await resolveEffectiveCodexModels(nativeModels)).map((model) => model.id))
      .toEqual(["dpcc-b"]);

    now.mockReturnValue(62_000);
    mockResolveCodexUpstream.mockReturnValue(upstreamA);
    expect((await resolveEffectiveCodexModels(nativeModels)).map((model) => model.id))
      .toEqual(["dpcc-a"]);
  });

  it("keeps an empty successful DPCC response authoritative", async () => {
    const nativeModels = [createCodexModel({ displayName: "Native", isDefault: true })];
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

    expect(await resolveEffectiveCodexModels(nativeModels)).toEqual([]);
  });
});
