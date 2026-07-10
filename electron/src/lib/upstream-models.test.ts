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

  it("keeps an explicit empty data array as a valid authoritative response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({ models: [], error: null });
  });
});
