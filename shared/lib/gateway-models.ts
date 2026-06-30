import type { GatewayModelMapping } from "../types/settings";

export type GatewayEngine = "claude" | "codex";

export const CLAUDE_GATEWAY_MODEL_PRESETS: GatewayModelMapping[] = [
  { displayName: "Claude Fable 5", modelId: "claude-fable-5" },
  { displayName: "Claude Opus 4.8", modelId: "claude-opus-4-8" },
  { displayName: "Claude Sonnet 4.6", modelId: "claude-sonnet-4-6" },
  { displayName: "Claude Haiku 4.5", modelId: "claude-haiku-4-5" },
];

export const CODEX_GATEWAY_MODEL_PRESETS: GatewayModelMapping[] = [
  { displayName: "GPT-5.5", modelId: "gpt-5.5" },
  { displayName: "GPT-5.4", modelId: "gpt-5.4" },
  { displayName: "GPT-5.4 mini", modelId: "gpt-5.4-mini" },
  { displayName: "GPT-5.3 Codex Spark", modelId: "gpt-5.3-codex-spark" },
];

const PRESETS: Record<GatewayEngine, GatewayModelMapping[]> = {
  claude: CLAUDE_GATEWAY_MODEL_PRESETS,
  codex: CODEX_GATEWAY_MODEL_PRESETS,
};

export function buildGatewayModelMappings(
  engine: GatewayEngine,
  mappings: GatewayModelMapping[] | undefined,
): GatewayModelMapping[] {
  const seen = new Set<string>();
  const overriddenNames = new Set(
    (mappings ?? [])
      .map((mapping) => mapping.displayName.trim().toLowerCase())
      .filter(Boolean),
  );
  const merged: GatewayModelMapping[] = [];
  const presetCandidates = PRESETS[engine].filter((mapping) => !overriddenNames.has(mapping.displayName.toLowerCase()));
  for (const mapping of [...(mappings ?? []), ...presetCandidates]) {
    const modelId = mapping.modelId.trim();
    const displayName = mapping.displayName.trim();
    if (!modelId) continue;
    const key = modelId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ displayName, modelId });
  }

  return merged;
}

export function getVisibleGatewayModels({
  models,
  activeModel,
  expanded,
  limit = 5,
}: {
  models: string[];
  activeModel: string | null;
  expanded: boolean;
  limit?: number;
}): { visible: string[]; hiddenCount: number; totalCount: number } {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const model of [activeModel, ...models]) {
    const normalized = (model ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  if (expanded || deduped.length <= limit) {
    return { visible: deduped, hiddenCount: 0, totalCount: deduped.length };
  }

  return {
    visible: deduped.slice(0, limit),
    hiddenCount: deduped.length - limit,
    totalCount: deduped.length,
  };
}
