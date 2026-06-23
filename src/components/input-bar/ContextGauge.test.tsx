import { describe, expect, it } from "vitest";
import { calculateCacheHitRate } from "./ContextGauge";

describe("ContextGauge", () => {
  it("calculates cache hit rate as cache read tokens over total input tokens", () => {
    expect(calculateCacheHitRate({
      inputTokens: 500,
      cacheReadTokens: 1_000,
      cacheCreationTokens: 500,
      outputTokens: 100,
      contextWindow: 10_000,
    })).toBe(50);
  });
});
