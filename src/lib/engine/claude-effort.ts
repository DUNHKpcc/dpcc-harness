import type { ClaudeEffort, ModelInfo } from "@/types";
import { getModelEffortProfile } from "@shared/lib/model-effort-capabilities";

const CLAUDE_EFFORTS = new Set<ClaudeEffort>(["low", "medium", "high", "xhigh", "max"]);
const DEFAULT_SDK_EFFORTS: ClaudeEffort[] = ["low", "medium", "high", "max"];

/** Runtime metadata wins; ID-only catalogs use the documented model profile. */
export function getClaudeEffortOptions(
  currentModel: ModelInfo | undefined,
  models: ModelInfo[],
): ClaudeEffort[] {
  if (currentModel?.supportsEffort === true) {
    return currentModel.supportedEffortLevels?.length
      ? currentModel.supportedEffortLevels
      : DEFAULT_SDK_EFFORTS;
  }

  const catalogHasEffortMetadata = models.some(
    (model) => model.supportsEffort !== undefined
      || (model.supportedEffortLevels?.length ?? 0) > 0,
  );
  if (catalogHasEffortMetadata) return [];

  const profile = getModelEffortProfile(currentModel?.value);
  return profile?.levels.filter(
    (level): level is ClaudeEffort => CLAUDE_EFFORTS.has(level as ClaudeEffort),
  ) ?? [];
}

/** Pick a valid effort after a Claude model change or session initialization. */
export function resolveClaudeEffort(
  modelId: string | undefined,
  models: ModelInfo[],
  preferred: ClaudeEffort,
): ClaudeEffort | undefined {
  const model = models.find((entry) => entry.value === modelId);
  const supported = getClaudeEffortOptions(model, models);
  if (supported.length === 0) return undefined;
  if (supported.includes(preferred)) return preferred;

  const documentedDefault = getModelEffortProfile(modelId)?.defaultLevel;
  if (documentedDefault && supported.includes(documentedDefault as ClaudeEffort)) {
    return documentedDefault as ClaudeEffort;
  }
  return supported.includes("high") ? "high" : supported[0];
}
