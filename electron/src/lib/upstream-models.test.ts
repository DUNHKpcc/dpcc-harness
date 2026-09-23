import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchUpstreamModels } from "./upstream-models";

describe("fetchUpstreamModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a successful response whose data field is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ object: "list" }),
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({ models: [], error: "invalid_response" });
  });

  it("rejects a successful response whose outer body is null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => null,
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({ models: [], error: "invalid_response" });
  });

  it("keeps an explicit empty data array as a valid authoritative response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({ models: [], error: null });
  });

  it("keeps an ID-only response in the original result shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "codex-dpcc" }] }),
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({ models: ["codex-dpcc"], error: null });
  });

  it("ignores non-object model items", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          null,
          "not-a-model",
          42,
          { id: "codex-id-only" },
          { id: "codex-second" },
        ],
      }),
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({
        models: ["codex-id-only", "codex-second"],
        error: null,
      });
  });

  it("classifies rate limits and preserves Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: () => "12" },
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example", "sk-dpcc"))
      .resolves.toMatchObject({
        models: [],
        error: "429 Too Many Requests",
        errorCode: "upstream_rate_limited",
        httpStatus: 429,
        retryAfterMs: 12_000,
      });
  });

  it("classifies gateway and service failures as retryable upstream errors", async () => {
    for (const [status, errorCode] of [
      [502, "upstream_bad_gateway"],
      [503, "upstream_service_unavailable"],
      [504, "upstream_gateway_timeout"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: false,
        status,
        statusText: "Upstream failure",
        headers: { get: () => null },
      })));

      await expect(fetchUpstreamModels("https://api.dpcc.example", "sk-dpcc"))
        .resolves.toMatchObject({ errorCode, httpStatus: status });
    }
  });

  it("ignores an invalid Retry-After header instead of exposing NaN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: () => "not-a-date" },
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example", "sk-dpcc"))
      .resolves.toMatchObject({
        errorCode: "upstream_rate_limited",
        httpStatus: 429,
      });
    await expect(fetchUpstreamModels("https://api.dpcc.example", "sk-dpcc"))
      .resolves.not.toHaveProperty("retryAfterMs");
  });
});
