import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchUpstreamModels: vi.fn(),
  resolveClaudeUpstream: vi.fn(),
}));

vi.mock("../upstream-resolver", () => ({
  resolveClaudeUpstream: mocks.resolveClaudeUpstream,
}));

vi.mock("../upstream-models", () => ({
  fetchUpstreamModels: mocks.fetchUpstreamModels,
}));

import {
  claudeUpstreamFingerprint,
  clearClaudeModelCatalogCache,
  resolveClaudeModelForRequest,
  resolveEffectiveClaudeModels,
  resolveEffectiveClaudeModelsResult,
} from "../claude-model-catalog";
import type { CachedModelInfo } from "../claude-model-cache";

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

const sdkModels: CachedModelInfo[] = [
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Local SDK metadata",
    supportsEffort: true,
  },
  {
    value: "claude-opus-4-6",
    displayName: "Local Opus",
    description: "Must not appear in the DPCC catalog",
    supportsAdaptiveThinking: true,
  },
];

describe("Claude model catalog", () => {
  beforeEach(() => {
    clearClaudeModelCatalogCache();
    mocks.fetchUpstreamModels.mockReset();
    mocks.resolveClaudeUpstream.mockReset();
    mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream());
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("uses an opaque fingerprint that includes source, credential, and model identity", () => {
    const base = defaultUpstream();

    expect(claudeUpstreamFingerprint(base)).not.toBe(
      claudeUpstreamFingerprint({ ...base, tier: "gateway" }),
    );
    expect(claudeUpstreamFingerprint(base)).not.toBe(
      claudeUpstreamFingerprint({ ...base, token: "token-b" }),
    );
    expect(claudeUpstreamFingerprint(base)).not.toBe(
      claudeUpstreamFingerprint({ ...base, model: "claude-opus-4-6" }),
    );
  });

  it("uses DPCC ids as the sole authoritative catalog", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["claude-opus-4-6", "claude-dpcc-only"],
      error: null,
    });

    await expect(resolveEffectiveClaudeModelsResult(sdkModels)).resolves.toEqual({
      models: [
        {
          value: "claude-opus-4-6",
          displayName: "claude-opus-4-6",
          description: "",
          supportsEffort: true,
          supportedEffortLevels: ["low", "medium", "high", "max"],
        },
        {
          value: "claude-dpcc-only",
          displayName: "claude-dpcc-only",
          description: "",
        },
      ],
      authoritative: true,
    });
  });

  it("does not borrow SDK metadata while adding app-owned effort capabilities", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["sonnet", "claude-opus-4-6"],
      error: null,
    });

    await expect(resolveEffectiveClaudeModels(sdkModels)).resolves.toEqual([
      { value: "sonnet", displayName: "sonnet", description: "" },
      {
        value: "claude-opus-4-6",
        displayName: "claude-opus-4-6",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
    ]);
  });

  it("applies per-model DPCC effort profiles without treating thinking toggles as effort", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["deepseek-v4-pro", "claude-sonnet-5", "glm-5.1", "kimi-k2.7-code"],
      error: null,
    });

    const models = await resolveEffectiveClaudeModels([]);

    expect(models[0].supportedEffortLevels).toEqual(["high", "max"]);
    expect(models[1].supportedEffortLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(models[2]).not.toHaveProperty("supportsEffort");
    expect(models[3]).not.toHaveProperty("supportsEffort");
  });

  it("uses only DPCC-authoritative model ids for default-upstream requests", async () => {
    mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream({ model: "" }));
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["claude-haiku-4-5", "claude-sonnet-4-6"],
      error: null,
    });

    await expect(resolveClaudeModelForRequest("claude-sonnet-4-6"))
      .resolves.toBe("claude-sonnet-4-6");
    await expect(resolveClaudeModelForRequest("local-sdk-model"))
      .resolves.toBe("claude-haiku-4-5");
  });

  it("trims and deduplicates DPCC IDs while retaining their order", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["  claude-sonnet-4-6 ", "", "claude-sonnet-4-6", "  ", "claude-dpcc-only"],
      error: null,
    });

    const result = await resolveEffectiveClaudeModels(sdkModels);

    expect(result.map((model) => model.value)).toEqual([
      "claude-sonnet-4-6",
      "claude-dpcc-only",
    ]);
  });

  it("treats a successful empty DPCC catalog as authoritative", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({ models: [], error: null });

    await expect(resolveEffectiveClaudeModelsResult(sdkModels)).resolves.toEqual({
      models: [],
      authoritative: true,
    });
  });

  it("does not fall back to SDK models when the DPCC request fails", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({ models: [], error: "unavailable" });

    await expect(resolveEffectiveClaudeModelsResult(sdkModels)).resolves.toEqual({
      models: [],
      authoritative: false,
    });
  });

  it("does not fall back to SDK models when an expired DPCC catalog cannot refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    mocks.fetchUpstreamModels
      .mockResolvedValueOnce({ models: ["claude-sonnet-4-6"], error: null })
      .mockResolvedValueOnce({ models: [], error: "unavailable" });

    await resolveEffectiveClaudeModels(sdkModels);
    vi.setSystemTime(new Date(60_000));

    await expect(resolveEffectiveClaudeModelsResult(sdkModels)).resolves.toEqual({
      models: [],
      authoritative: false,
    });
    expect(mocks.fetchUpstreamModels).toHaveBeenCalledTimes(2);
  });

  it("caches a successful DPCC catalog for 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["claude-sonnet-4-6"],
      error: null,
    });

    await resolveEffectiveClaudeModels(sdkModels);
    vi.setSystemTime(new Date(59_999));
    await resolveEffectiveClaudeModels(sdkModels);

    expect(mocks.fetchUpstreamModels).toHaveBeenCalledTimes(1);
  });

  it("isolates cached catalogs by base URL and token", async () => {
    let upstream = defaultUpstream({ baseUrl: "https://one.example", token: "token-one" });
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    mocks.fetchUpstreamModels
      .mockResolvedValueOnce({ models: ["claude-one"], error: null })
      .mockResolvedValueOnce({ models: ["claude-two"], error: null })
      .mockResolvedValueOnce({ models: ["claude-three"], error: null });

    const first = await resolveEffectiveClaudeModels(sdkModels);
    upstream = defaultUpstream({ baseUrl: "https://one.example", token: "token-two" });
    const second = await resolveEffectiveClaudeModels(sdkModels);
    upstream = defaultUpstream({ baseUrl: "https://two.example", token: "token-two" });
    const third = await resolveEffectiveClaudeModels(sdkModels);

    expect(first.map((model) => model.value)).toEqual(["claude-one"]);
    expect(second.map((model) => model.value)).toEqual(["claude-two"]);
    expect(third.map((model) => model.value)).toEqual(["claude-three"]);
    expect(mocks.fetchUpstreamModels).toHaveBeenCalledTimes(3);
  });

  it("does not reuse another credential's catalog after a DPCC failure", async () => {
    let upstream = defaultUpstream({ baseUrl: "https://one.example", token: "token-one" });
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    mocks.fetchUpstreamModels
      .mockResolvedValueOnce({ models: ["claude-account-one"], error: null })
      .mockResolvedValueOnce({ models: [], error: "unavailable" });

    await resolveEffectiveClaudeModels(sdkModels);
    upstream = defaultUpstream({ baseUrl: "https://two.example", token: "token-two" });

    await expect(resolveEffectiveClaudeModels(sdkModels)).resolves.toEqual([]);
    expect(mocks.fetchUpstreamModels).toHaveBeenCalledTimes(2);
  });

  it("resolves against the current upstream when the source changes during a request", async () => {
    let upstream = defaultUpstream({ baseUrl: "https://a.example", token: "token-a" });
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    let resolveA!: (value: { models: string[]; error: null }) => void;
    let resolveB!: (value: { models: string[]; error: null }) => void;
    mocks.fetchUpstreamModels.mockImplementation((baseUrl: string) => new Promise((resolve) => {
      if (baseUrl === "https://a.example") resolveA = resolve;
      if (baseUrl === "https://b.example") resolveB = resolve;
    }));

    const fromA = resolveEffectiveClaudeModels(sdkModels);
    upstream = defaultUpstream({ baseUrl: "https://b.example", token: "token-b" });
    const fromB = resolveEffectiveClaudeModels(sdkModels);

    resolveB({ models: ["claude-account-b"], error: null });
    await expect(fromB).resolves.toEqual([
      { value: "claude-account-b", displayName: "claude-account-b", description: "" },
    ]);
    resolveA({ models: ["claude-account-a"], error: null });
    await expect(fromA).resolves.toEqual([
      { value: "claude-account-b", displayName: "claude-account-b", description: "" },
    ]);
    expect(mocks.fetchUpstreamModels).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent requests for the same credentials", async () => {
    let resolveFetch!: (value: { models: string[]; error: null }) => void;
    mocks.fetchUpstreamModels.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const first = resolveEffectiveClaudeModels(sdkModels);
    const second = resolveEffectiveClaudeModels(sdkModels);

    expect(mocks.fetchUpstreamModels).toHaveBeenCalledTimes(1);
    resolveFetch({ models: ["claude-sonnet-4-6"], error: null });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("does not allow a pre-clear request to populate a newer cache generation", async () => {
    let resolveFirst!: (value: { models: string[]; error: null }) => void;
    let resolveSecond!: (value: { models: string[]; error: null }) => void;
    mocks.fetchUpstreamModels
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const first = resolveEffectiveClaudeModels(sdkModels);
    clearClaudeModelCatalogCache();
    const second = resolveEffectiveClaudeModels(sdkModels);

    resolveSecond({ models: ["claude-fresh"], error: null });
    await expect(second).resolves.toEqual([
      { value: "claude-fresh", displayName: "claude-fresh", description: "" },
    ]);
    resolveFirst({ models: ["claude-stale"], error: null });
    await expect(first).resolves.toEqual([]);
  });

  it.each(["local", "gateway"] as const)("preserves SDK models for %s sources", async (tier) => {
    mocks.resolveClaudeUpstream.mockReturnValue({ ...defaultUpstream(), tier });

    const result = await resolveEffectiveClaudeModelsResult(sdkModels);

    expect(result).toEqual({ models: sdkModels, authoritative: false });
    expect(result.models).toBe(sdkModels);
    expect(mocks.fetchUpstreamModels).not.toHaveBeenCalled();
  });

  it("marks a source change during a DPCC request as stale", async () => {
    let upstream = defaultUpstream({ baseUrl: "https://a.example", token: "token-a" });
    mocks.resolveClaudeUpstream.mockImplementation(() => upstream);
    let resolveRequest!: (value: { models: string[]; error: null }) => void;
    mocks.fetchUpstreamModels.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const result = resolveEffectiveClaudeModelsResult([], claudeUpstreamFingerprint(upstream));
    upstream = defaultUpstream({ baseUrl: "https://b.example", token: "token-b" });
    resolveRequest({ models: [], error: null });

    await expect(result).resolves.toEqual({
      models: [],
      authoritative: false,
      stale: true,
    });
  });
});
