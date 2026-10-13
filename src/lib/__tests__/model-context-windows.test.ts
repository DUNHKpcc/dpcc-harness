import { describe, expect, it } from "vitest";
import { getDpccModelContextWindow } from "@shared/lib/model-context-windows";

describe("DPCC API context capacities", () => {
  it.each([
    ["gpt-6.1-sol", 1_050_000], ["gpt-5.6-luna", 1_050_000],
    ["gpt-5.5", 1_050_000], ["gpt-5.3-codex-spark", 128_000],
    ["gpt-oss-120b-medium", 131_072], ["claude-opus-5-5", 1_000_000],
    ["claude-sonnet-4-6", 1_000_000], ["claude-fable-5-1", 1_000_000],
    ["claude-haiku-5-5", 1_000_000], ["claude-haiku-4-5", 200_000],
    ["claude-haiku-4-5-20251001", 200_000], ["gemini-3.8-flash", 1_048_576],
    ["gemini-2.5-flash", 1_048_576], ["deepseek-v4-flash", 1_000_000],
    ["grok-4.3", 1_000_000], ["grok-4.7", 500_000],
  ])("resolves %s to %i tokens", (modelId, capacity) => {
    expect(getDpccModelContextWindow(modelId)).toBe(capacity);
  });

  it("handles provider-qualified IDs without inventing capacities for unknown models", () => {
    expect(getDpccModelContextWindow(" pcc-agent-dpcc-codex/GPT-6.1-SOL ")).toBe(1_050_000);
    for (const id of ["future-gpt-7", "gpt-image-2", "codex-auto-review", "constructor", "__proto__"]) {
      expect(getDpccModelContextWindow(id)).toBeUndefined();
    }
  });
});
