import { describe, expect, it } from "vitest";
import { getCanonicalClaudeModelForCatalog } from "../useAppOrchestrator";
import { canonicalizeModelValue } from "@/lib/model-utils";

describe("getCanonicalClaudeModelForCatalog", () => {
  it("does not canonicalize against stale cached models when the resolved catalog is empty", () => {
    const staleCachedModels = [{
      value: "default",
      displayName: "Default",
      description: "Claude Opus",
    }];

    expect(canonicalizeModelValue("claude-opus-4-6", staleCachedModels)).toBe("default");
    expect(getCanonicalClaudeModelForCatalog("claude-opus-4-6", [])).toBeUndefined();
  });
});
