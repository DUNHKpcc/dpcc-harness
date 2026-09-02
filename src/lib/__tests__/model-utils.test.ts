import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@/types";
import {
  areModelsEquivalent,
  canonicalizeModelValue,
  findEquivalentModel,
  getModelBrand,
  getModelDisplayName,
  resolveClaudePickerValue,
  resolveModelValue,
} from "../model-utils";

const cachedModels: ModelInfo[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 4.6 with 1M context",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 4.6",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "sonnet[1m]",
    displayName: "Sonnet (1M context)",
    description: "Sonnet 4.6 with 1M context",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "haiku",
    displayName: "Haiku",
    description: "Haiku 4.5",
  },
  {
    value: "claude-opus-4-6",
    displayName: "Opus 4.6",
    description: "claude-opus-4-6",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
];

describe("getModelDisplayName", () => {
  it("hides the provider prefix from a qualified Pi model ID", () => {
    expect(getModelDisplayName("pcc-agent-dpcc-codex/gpt-5.3-codex-spark"))
      .toBe("gpt-5.3-codex-spark");
  });

  it("keeps unqualified and nested model IDs intact after the provider", () => {
    expect(getModelDisplayName("gpt-5.3-codex-spark")).toBe("gpt-5.3-codex-spark");
    expect(getModelDisplayName("openrouter/anthropic/claude-sonnet-4"))
      .toBe("anthropic/claude-sonnet-4");
  });
});

describe("getModelBrand", () => {
  it.each([
    ["anthropic/claude-opus-4-6", "claude"],
    ["pcc-agent-dpcc-codex/gpt-5.3-codex-spark", "openai"],
    ["xai/grok-4", "grok"],
    ["deepseek/deepseek-r1", "deepseek"],
    ["moonshot/kimi-k2", "kimi"],
    ["zhipu/glm-5", "zhipu"],
    ["google/gemini-3-pro", "gemini"],
    ["alibaba/qwen3-coder", "qwen"],
    ["meta/llama-4", "meta"],
    ["mistral/codestral", "mistral"],
  ] as const)("maps %s to the %s icon", (model, brand) => {
    expect(getModelBrand(model)).toBe(brand);
  });

  it("prefers the model family over a generic provider prefix", () => {
    expect(getModelBrand("pcc-agent-dpcc-codex/deepseek-v4"))
      .toBe("deepseek");
  });

  it("does not mistake a managed route name for the model family", () => {
    expect(getModelBrand("pcc-agent-dpcc-codex/custom-model"))
      .toBeNull();
    expect(getModelBrand("anthropic/custom-model"))
      .toBe("claude");
  });
});

describe("resolveModelValue", () => {
  it("maps a saved 1M Opus runtime id to the default alias when the cache is stale", () => {
    expect(resolveModelValue("claude-opus-4-6[1m]", cachedModels)).toBe("default");
  });

  it("falls back to the closest cached Opus entry when the default alias is unavailable", () => {
    expect(
      resolveModelValue(
        "claude-opus-4-6[1m]",
        cachedModels.filter((entry) => entry.value !== "default"),
      ),
    ).toBe("claude-opus-4-6");
  });

  it("prefers an exact cached match over the default alias", () => {
    expect(
      resolveModelValue("claude-opus-4-6[1m]", [
        ...cachedModels,
        {
          value: "claude-opus-4-6[1m]",
          displayName: "Opus 4.6 (with 1M context)",
          description: "Newest 1M Opus",
          supportsEffort: true,
          supportedEffortLevels: ["low", "medium", "high", "max"],
        },
      ]),
    ).toBe("claude-opus-4-6[1m]");
  });

  it("infers the default alias family from model metadata instead of treating it as Opus", () => {
    const sonnetDefaultModels: ModelInfo[] = [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Sonnet 4.6 with 1M context",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high"],
      },
      {
        value: "claude-opus-4-6[1m]",
        displayName: "Opus 4.6 (1M)",
        description: "Opus",
      },
    ];

    expect(resolveModelValue("claude-sonnet-4-6[1m]", sonnetDefaultModels)).toBe("default");
  });
});

describe("findEquivalentModel", () => {
  it("returns the cached entry that should drive effort metadata", () => {
    expect(findEquivalentModel("claude-opus-4-6[1m]", cachedModels)?.value).toBe("default");
  });
});

describe("canonicalizeModelValue", () => {
  it("prefers the stable default alias over a concrete runtime id", () => {
    expect(canonicalizeModelValue("claude-opus-4-6[1m]", cachedModels)).toBe("default");
  });

  it("keeps an exact value when no better alias exists", () => {
    expect(canonicalizeModelValue("claude-opus-4-6[1m]", [
      ...cachedModels.filter((entry) => entry.value !== "default"),
      {
        value: "claude-opus-4-6[1m]",
        displayName: "Opus 4.6 (with 1M context)",
        description: "Newest 1M Opus",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
    ])).toBe("claude-opus-4-6[1m]");
  });
});

describe("resolveClaudePickerValue", () => {
  it("keeps the SDK default alias when the active catalog exposes it", () => {
    expect(resolveClaudePickerValue("default", cachedModels)).toBe("default");
  });

  it("replaces the SDK default alias with a concrete DPCC catalog model", () => {
    const dpccModels = cachedModels.filter((entry) => entry.value !== "default");

    expect(resolveClaudePickerValue("default", dpccModels)).toBe("sonnet");
  });

  it("does not invent a model before the active catalog is loaded", () => {
    expect(resolveClaudePickerValue("default", [])).toBeUndefined();
  });
});

describe("areModelsEquivalent", () => {
  it("still distinguishes different non-default variants", () => {
    expect(areModelsEquivalent("sonnet", "sonnet[1m]")).toBe(false);
  });

  it("does not hard-code default as equivalent to Opus without metadata", () => {
    expect(areModelsEquivalent("default", "claude-opus-4-6")).toBe(false);
  });
});
