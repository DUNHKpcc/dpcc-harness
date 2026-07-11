/**
 * Pure helpers shared between Electron and CLI Codex engine implementations.
 */

import type { CodexModel } from "../types/codex";

export const SUPPORTED_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
]);

export function isSupportedServerRequestMethod(method: string): boolean {
  return SUPPORTED_SERVER_REQUESTS.has(method);
}

/** Pick a valid model id from model/list, preferring the requested id when available. */
export function pickModelId(
  requestedModel: string | undefined,
  models: CodexModel[],
): string | undefined {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (requested.length > 0) {
    const hasRequested = models.some((m) => m.id === requested);
    if (hasRequested) return requested;
  }

  const defaultModel = models.find((m) => m.isDefault === true);
  if (defaultModel) return defaultModel.id;

  const first = models[0];
  return first?.id;
}

const REASONING_EFFORT_DESCRIPTIONS = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
} as const;

const CODEX_SPARK_MODEL_ID = "gpt-5.3-codex-spark";

function createUpstreamCodexModel(id: string): CodexModel {
  const supportedReasoningEfforts = id === CODEX_SPARK_MODEL_ID
    ? (["low", "medium", "high", "xhigh"] as const).map((reasoningEffort) => ({
        reasoningEffort,
        description: REASONING_EFFORT_DESCRIPTIONS[reasoningEffort],
      }))
    : [];

  return {
    id,
    model: id,
    upgrade: null,
    displayName: id,
    description: "",
    hidden: false,
    supportedReasoningEfforts,
    defaultReasoningEffort: id === CODEX_SPARK_MODEL_ID ? "high" : "none",
    inputModalities: ["text"],
    supportsPersonality: false,
    isDefault: false,
  };
}

/**
 * Build the Codex catalog for an authoritative upstream model-id list.
 * Native entries only contribute metadata; they do not make an unavailable
 * model visible when the upstream omits it.
 */
export function mergeCodexModelsForUpstream(
  nativeModels: CodexModel[],
  upstreamModelIds: string[],
  preferredModel?: string,
): CodexModel[] {
  const ids = Array.from(new Set(upstreamModelIds.map((id) => id.trim()).filter(Boolean)));
  const nativeById = new Map<string, CodexModel>();
  for (const model of nativeModels) {
    nativeById.set(model.id, model);
    nativeById.set(model.model, model);
  }

  const preferred = preferredModel?.trim();
  const defaultId = preferred && ids.includes(preferred)
    ? preferred
    : nativeModels.find((model) => model.isDefault && ids.includes(model.id))?.id ?? ids[0];

  return ids.map((id) => ({
    ...(nativeById.get(id) ?? createUpstreamCodexModel(id)),
    id,
    model: id,
    hidden: false,
    isDefault: id === defaultId,
  }));
}

/** Never send a guessed reasoning effort for a model that does not advertise one. */
export function resolveCodexReasoningEffort(
  model: {
    supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
    defaultReasoningEffort: string;
  } | undefined,
  requestedEffort: string | undefined,
): string | undefined {
  const requested = requestedEffort?.trim();
  if (!model) return undefined;

  const supported = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
  if (supported.length === 0) return undefined;
  if (requested && supported.includes(requested)) return requested;
  if (supported.includes(model.defaultReasoningEffort)) return model.defaultReasoningEffort;
  return supported[0];
}
