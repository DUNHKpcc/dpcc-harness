import { describe, expect, it } from "vitest";
import {
  CLAUDE_GATEWAY_MODEL_PRESETS,
  CODEX_GATEWAY_MODEL_PRESETS,
  buildGatewayModelMappings,
  getVisibleGatewayModels,
} from "../gateway-models";

describe("gateway model helpers", () => {
  it("keeps the active model visible while collapsing long upstream lists to five items", () => {
    const result = getVisibleGatewayModels({
      models: ["m1", "m2", "m3", "m4", "m5", "m6", "m7"],
      activeModel: "m7",
      expanded: false,
      limit: 5,
    });

    expect(result.visible).toEqual(["m7", "m1", "m2", "m3", "m4"]);
    expect(result.hiddenCount).toBe(2);
    expect(result.totalCount).toBe(7);
  });

  it("returns the full deduped list when expanded", () => {
    const result = getVisibleGatewayModels({
      models: ["m1", "m2", "m1", "m3", "m4", "m5", "m6"],
      activeModel: "m5",
      expanded: true,
      limit: 5,
    });

    expect(result.visible).toEqual(["m5", "m1", "m2", "m3", "m4", "m6"]);
    expect(result.hiddenCount).toBe(0);
    expect(result.totalCount).toBe(6);
  });

  it("backfills Claude gateway mappings with at least four official presets", () => {
    const mappings = buildGatewayModelMappings("claude", [{ displayName: "Custom Sonnet", modelId: "upstream-sonnet" }]);

    expect(mappings).toHaveLength(CLAUDE_GATEWAY_MODEL_PRESETS.length + 1);
    expect(mappings[0]).toEqual({ displayName: "Custom Sonnet", modelId: "upstream-sonnet" });
    expect(mappings.map((m) => m.modelId)).toContain("claude-opus-4-8");
    expect(mappings.map((m) => m.modelId)).toContain("claude-haiku-4-5");
  });

  it("backfills Codex gateway mappings with at least four official presets", () => {
    const mappings = buildGatewayModelMappings("codex", []);

    expect(mappings).toEqual(CODEX_GATEWAY_MODEL_PRESETS);
    expect(mappings).toHaveLength(4);
  });

  it("treats a matching display name as an override for an official preset", () => {
    const mappings = buildGatewayModelMappings("codex", [{ displayName: "GPT-5.5", modelId: "gateway-gpt-5.5" }]);

    expect(mappings.map((m) => m.modelId)).toContain("gateway-gpt-5.5");
    expect(mappings.map((m) => m.modelId)).not.toContain("gpt-5.5");
    expect(mappings).toHaveLength(CODEX_GATEWAY_MODEL_PRESETS.length);
  });
});
