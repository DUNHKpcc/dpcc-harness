import type { ACPConfigOption } from "@shared/types/acp";

interface LegacyAcpModel {
  modelId: string;
  name: string;
  description?: string | null;
}

interface LegacyAcpMode {
  id: string;
  name: string;
  description?: string | null;
}

export interface LegacyAcpSessionConfiguration {
  models?: {
    currentModelId?: string;
    availableModels?: LegacyAcpModel[];
  } | null;
  modes?: {
    currentModeId?: string;
    availableModes?: LegacyAcpMode[];
  } | null;
}

const PI_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

/** Convert legacy unstable ACP model/mode state into stable config options. */
export function synthesizeLegacyAcpConfigOptions(
  session: LegacyAcpSessionConfiguration,
): ACPConfigOption[] {
  const options: ACPConfigOption[] = [];
  const models = session.models?.availableModels ?? [];
  if (models.length > 0) {
    options.push({
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: session.models?.currentModelId ?? models[0].modelId,
      options: models.map((model) => ({
        value: model.modelId,
        name: model.name,
        description: model.description ?? null,
      })),
    });
  }

  const modes = session.modes?.availableModes ?? [];
  if (modes.length > 0) {
    const isThinkingSelector = modes.every((mode) => PI_THINKING_LEVELS.has(mode.id));
    options.push({
      id: isThinkingSelector ? "thought_level" : "mode",
      name: isThinkingSelector ? "Thinking" : "Mode",
      category: isThinkingSelector ? "thought_level" : "mode",
      type: "select",
      currentValue: session.modes?.currentModeId ?? modes[0].id,
      options: modes.map((mode) => ({
        value: mode.id,
        name: mode.name,
        description: mode.description ?? null,
      })),
    });
  }

  return options;
}

export function isLegacyModeConfig(
  configId: string,
  options: ACPConfigOption[] | undefined,
): boolean {
  const option = options?.find((candidate) => candidate.id === configId);
  return configId === "mode"
    || configId === "thought_level"
    || option?.category === "mode"
    || option?.category === "thought_level";
}

export function updateAcpConfigCurrentValue(
  options: ACPConfigOption[] | undefined,
  configId: string,
  value: string,
): ACPConfigOption[] | undefined {
  if (!options) return undefined;
  return options.map((option) => option.id === configId
    ? { ...option, currentValue: value }
    : option);
}
