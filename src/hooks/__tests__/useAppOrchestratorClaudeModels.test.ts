import { describe, expect, it } from "vitest";
import {
  getCanonicalClaudeModelForCatalog,
  getValidCodexModelForCatalog,
} from "../useAppOrchestrator";
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

  it("replaces an unavailable default alias with the authoritative catalog default", () => {
    expect(getCanonicalClaudeModelForCatalog("default", [{
      value: "claude-sonnet-5",
      displayName: "claude-sonnet-5",
      description: "",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    }])).toBe("claude-sonnet-5");
  });

  it("falls back to the authorized Codex model when the saved model is unavailable", () => {
    expect(getValidCodexModelForCatalog("stale-native-model", [{
      id: "pcc-local-test",
      displayName: "pcc-local-test",
      description: "",
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "none",
      isDefault: true,
    }])).toBe("pcc-local-test");
  });
});
