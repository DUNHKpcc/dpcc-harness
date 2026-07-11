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

  it("parses supported effort capabilities while filtering unknown metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "codex-dpcc",
            supported_reasoning_efforts: ["minimal", "unsupported", "high", 42],
            default_reasoning_effort: "high",
          },
          {
            id: "codex-no-default",
            supported_reasoning_efforts: ["none"],
            default_reasoning_effort: "xhigh",
          },
          {
            id: "codex-id-only",
            supported_reasoning_efforts: ["unsupported"],
            default_reasoning_effort: "high",
          },
        ],
      }),
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({
        models: ["codex-dpcc", "codex-no-default", "codex-id-only"],
        capabilities: {
          "codex-dpcc": {
            supportedReasoningEfforts: ["minimal", "high"],
            defaultReasoningEffort: "high",
          },
          "codex-no-default": {
            supportedReasoningEfforts: ["none"],
          },
        },
        error: null,
      });
  });

  it("keeps an ID-only response in the original result shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "codex-dpcc" }] }),
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({ models: ["codex-dpcc"], error: null });
  });

  it("ignores non-object model items and non-array effort metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          null,
          "not-a-model",
          42,
          { id: "codex-id-only", supported_reasoning_efforts: "high" },
          { id: "codex-capable", supported_reasoning_efforts: ["medium"] },
        ],
      }),
    })));

    await expect(fetchUpstreamModels("https://api.dpcc.example/v1", "sk-dpcc"))
      .resolves.toEqual({
        models: ["codex-id-only", "codex-capable"],
        capabilities: {
          "codex-capable": { supportedReasoningEfforts: ["medium"] },
        },
        error: null,
      });
  });
});
