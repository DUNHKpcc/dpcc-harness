import { beforeEach, describe, expect, it, vi } from "vitest";

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
  clearClaudeModelCatalogCache,
  resolveEffectiveClaudeModels,
} from "../claude-model-catalog";
import type { CachedModelInfo } from "../claude-model-cache";

const defaultUpstream = (overrides: Partial<{
  baseUrl: string;
  token: string;
  model: string;
}> = {}) => ({
  tier: "default" as const,
  baseUrl: "https://api.dpcc.example",
  token: "sk-claude",
  model: "claude-sonnet-4-6",
  ...overrides,
});

const sdkModels: CachedModelInfo[] = [
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 4.6",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
  },
  {
    value: "claude-opus-4-6",
    displayName: "Opus 4.6",
    description: "Exact Opus metadata",
    supportsEffort: true,
  },
];

describe("Claude DPCC model catalog", () => {
  beforeEach(() => {
    clearClaudeModelCatalogCache();
    mocks.fetchUpstreamModels.mockReset();
    mocks.resolveClaudeUpstream.mockReset();
    mocks.resolveClaudeUpstream.mockReturnValue(defaultUpstream());
  });

  it("uses successful DPCC ids as the authoritative visible set", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["claude-opus-4-6", "claude-dpcc-only"],
      error: null,
    });

    const result = await resolveEffectiveClaudeModels(sdkModels);

    expect(result.map((model) => model.value)).toEqual([
      "claude-opus-4-6",
      "claude-dpcc-only",
    ]);
  });

  it("uses exact SDK metadata before alias metadata", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["claude-opus-4-6"],
      error: null,
    });

    const [result] = await resolveEffectiveClaudeModels(sdkModels);

    expect(result).toEqual(sdkModels[1]);
  });

  it("supplements matching Claude family aliases without mutating SDK models", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["claude-sonnet-4-6"],
      error: null,
    });
    const originalSdkModels = structuredClone(sdkModels);

    const [result] = await resolveEffectiveClaudeModels(sdkModels);

    expect(result).toEqual({
      value: "claude-sonnet-4-6",
      displayName: "Sonnet",
      description: "Sonnet 4.6",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      supportsAdaptiveThinking: true,
      supportsFastMode: true,
    });
    expect(sdkModels).toEqual(originalSdkModels);
  });

  it("uses plain fallback metadata for unknown, cross-family, and 1M-mismatched IDs", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({
      models: ["claude-dpcc-only", "claude-opus-4-6", "claude-sonnet-4-6-1m", "claude-haiku-4-5"],
      error: null,
    });

    const result = await resolveEffectiveClaudeModels([sdkModels[0], {
      value: "default",
      displayName: "SDK default",
      description: "Must not become a model family",
      supportsEffort: true,
    }]);

    expect(result).toEqual([
      { value: "claude-dpcc-only", displayName: "claude-dpcc-only", description: "" },
      { value: "claude-opus-4-6", displayName: "claude-opus-4-6", description: "" },
      { value: "claude-sonnet-4-6-1m", displayName: "claude-sonnet-4-6-1m", description: "" },
      { value: "claude-haiku-4-5", displayName: "claude-haiku-4-5", description: "" },
    ]);
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

    await expect(resolveEffectiveClaudeModels(sdkModels)).resolves.toEqual([]);
  });

  it("caches a successful catalog for 60 seconds", async () => {
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
    vi.useRealTimers();
  });

  it("falls back to the exact SDK array when the first DPCC request fails", async () => {
    mocks.fetchUpstreamModels.mockResolvedValue({ models: [], error: "unavailable" });

    const result = await resolveEffectiveClaudeModels(sdkModels);

    expect(result).toBe(sdkModels);
  });

  it("reuses a stale successful catalog for the same credentials after a request failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    mocks.fetchUpstreamModels
      .mockResolvedValueOnce({ models: ["claude-sonnet-4-6"], error: null })
      .mockResolvedValueOnce({ models: [], error: "unavailable" });

    const initial = await resolveEffectiveClaudeModels(sdkModels);
    vi.setSystemTime(new Date(60_000));
    const afterFailure = await resolveEffectiveClaudeModels(sdkModels);

    expect(afterFailure).toEqual(initial);
    expect(mocks.fetchUpstreamModels).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
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
    await expect(first).resolves.toBe(sdkModels);
  });

  it.each(["local", "gateway"] as const)("passes through the SDK array by reference for %s sources", async (tier) => {
    mocks.resolveClaudeUpstream.mockReturnValue({ ...defaultUpstream(), tier });

    const result = await resolveEffectiveClaudeModels(sdkModels);

    expect(result).toBe(sdkModels);
    expect(mocks.fetchUpstreamModels).not.toHaveBeenCalled();
  });
});
