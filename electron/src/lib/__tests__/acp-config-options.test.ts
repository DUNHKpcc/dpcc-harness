import { describe, expect, it } from "vitest";
import {
  isLegacyModeConfig,
  synthesizeLegacyAcpConfigOptions,
  updateAcpConfigCurrentValue,
} from "../acp-config-options";

describe("ACP legacy config options", () => {
  it("synthesizes Pi model and thinking selectors from legacy models/modes", () => {
    const options = synthesizeLegacyAcpConfigOptions({
      models: {
        currentModelId: "anthropic/claude-sonnet",
        availableModels: [
          { modelId: "anthropic/claude-sonnet", name: "Claude Sonnet" },
        ],
      },
      modes: {
        currentModeId: "high",
        availableModes: [
          { id: "off", name: "Off" },
          { id: "high", name: "High" },
          { id: "xhigh", name: "Extra High" },
        ],
      },
    });

    expect(options).toEqual([
      expect.objectContaining({
        id: "model",
        category: "model",
        currentValue: "anthropic/claude-sonnet",
      }),
      expect.objectContaining({
        id: "thought_level",
        name: "Thinking",
        category: "thought_level",
        currentValue: "high",
      }),
    ]);
  });

  it("preserves non-thinking legacy session modes as mode config", () => {
    const options = synthesizeLegacyAcpConfigOptions({
      modes: {
        currentModeId: "ask",
        availableModes: [
          { id: "ask", name: "Ask" },
          { id: "plan", name: "Plan" },
        ],
      },
    });

    expect(options[0]).toEqual(expect.objectContaining({
      id: "mode",
      name: "Mode",
      category: "mode",
      currentValue: "ask",
    }));
  });

  it("recognizes category-based mode fallbacks and updates cached state immutably", () => {
    const options = synthesizeLegacyAcpConfigOptions({
      modes: {
        currentModeId: "low",
        availableModes: [{ id: "low", name: "Low" }, { id: "high", name: "High" }],
      },
    });

    expect(isLegacyModeConfig("thought_level", options)).toBe(true);
    const updated = updateAcpConfigCurrentValue(options, "thought_level", "high");
    expect(updated?.[0].currentValue).toBe("high");
    expect(options[0].currentValue).toBe("low");
  });
});
