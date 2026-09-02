import { describe, expect, it } from "vitest";
import {
  areAcpConfigOptionsEqual,
  getAgentCachedSlashCommands,
  getAgentCachedConfigOptions,
  normalizeCachedAcpConfigOptions,
  normalizeCachedAcpSlashCommands,
  reconcileCachedAcpConfigCatalog,
  replaceCachedAcpModelCatalog,
  updateCachedAcpConfigValue,
} from "@shared/lib/acp-config-cache";

const modelOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select" as const,
  currentValue: "provider/model-a",
  options: [{ value: "provider/model-a", name: "Model A" }],
};

describe("ACP config cache", () => {
  it("drops malformed persisted entries", () => {
    expect(normalizeCachedAcpConfigOptions([
      modelOption,
      null,
      { ...modelOption, id: "" },
      { ...modelOption, type: "boolean" },
      { ...modelOption, options: null },
    ])).toEqual([modelOption]);
  });

  it("returns the matching agent cache only", () => {
    expect(getAgentCachedConfigOptions([
      { id: "custom", cachedConfigOptions: [] },
      { id: "pi-acp", cachedConfigOptions: [modelOption] },
    ], "pi-acp")).toEqual([modelOption]);
    expect(getAgentCachedConfigOptions([], "pi-acp")).toEqual([]);
  });

  it("compares independently loaded cache payloads by value", () => {
    expect(areAcpConfigOptionsEqual([modelOption], [{ ...modelOption }])).toBe(true);
    expect(areAcpConfigOptionsEqual([modelOption], [{
      ...modelOption,
      currentValue: "provider/model-b",
    }])).toBe(false);
  });

  it("updates a draft selector without a live ACP session", () => {
    expect(updateCachedAcpConfigValue([modelOption], "model", "provider/model-b"))
      .toEqual([{
        ...modelOption,
        currentValue: "provider/model-b",
      }]);
  });

  it("refreshes the model catalog while preserving other cached selectors", () => {
    const thinkingOption = {
      id: "thought_level",
      name: "Thinking",
      category: "thought_level",
      type: "select" as const,
      currentValue: "high",
      options: [
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    };

    expect(replaceCachedAcpModelCatalog(
      [modelOption, thinkingOption],
      [
        { value: "provider/model-a", name: "Model A" },
        { value: "provider/model-b", name: "Model B" },
      ],
    )).toEqual([
      {
        ...modelOption,
        options: [
          { value: "provider/model-a", name: "Model A" },
          { value: "provider/model-b", name: "Model B" },
        ],
      },
      thinkingOption,
    ]);
  });

  it("merges a refreshed dormant catalog without resetting its selection", () => {
    const selectedModel = {
      ...modelOption,
      currentValue: "provider/model-b",
      options: [
        ...modelOption.options,
        { value: "provider/model-b", name: "Model B" },
      ],
    };
    const refreshed = replaceCachedAcpModelCatalog(
      [modelOption],
      [
        { value: "provider/model-a", name: "Model A" },
        { value: "provider/model-b", name: "Model B" },
        { value: "provider/model-c", name: "Model C" },
      ],
    );

    expect(reconcileCachedAcpConfigCatalog([selectedModel], refreshed))
      .toEqual([{
        ...refreshed[0],
        currentValue: "provider/model-b",
      }]);
  });

  it("hydrates slash commands from the agent cache without starting Pi", () => {
    const cachedCommands = [{
      name: "compact",
      description: "Compact context",
      argumentHint: "",
      source: "acp" as const,
    }];
    expect(normalizeCachedAcpSlashCommands([
      ...cachedCommands,
      { name: "", description: "invalid", source: "acp" },
    ])).toEqual(cachedCommands);
    expect(getAgentCachedSlashCommands([
      { id: "pi-acp", cachedSlashCommands: cachedCommands },
    ], "pi-acp")).toEqual(cachedCommands);
  });
});
