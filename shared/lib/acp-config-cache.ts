import type {
  ACPConfigOption,
  ACPConfigSelectOption,
} from "../types/acp";
import type { SlashCommand } from "../types/engine";
import type { InstalledAgent } from "../types/registry";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Keep persisted/IPC config caches data-only and discard malformed entries. */
export function normalizeCachedAcpConfigOptions(value: unknown): ACPConfigOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter((option): option is ACPConfigOption => (
    isRecord(option)
    && typeof option.id === "string"
    && option.id.trim().length > 0
    && typeof option.name === "string"
    && option.type === "select"
    && typeof option.currentValue === "string"
    && Array.isArray(option.options)
  ));
}

export function getAgentCachedConfigOptions(
  agents: readonly Pick<InstalledAgent, "id" | "cachedConfigOptions">[],
  agentId: string | null | undefined,
): ACPConfigOption[] {
  const normalizedId = agentId?.trim();
  if (!normalizedId) return [];
  const agent = agents.find((candidate) => candidate.id === normalizedId);
  return normalizeCachedAcpConfigOptions(agent?.cachedConfigOptions);
}

/** Update a cached selector locally without requiring a live ACP session. */
export function updateCachedAcpConfigValue(
  options: ACPConfigOption[],
  configId: string,
  value: string,
): ACPConfigOption[] {
  let changed = false;
  const next = options.map((option) => {
    if (option.id !== configId || option.currentValue === value) return option;
    changed = true;
    return { ...option, currentValue: value };
  });
  return changed ? next : options;
}

function configOptionHasValue(option: ACPConfigOption, value: string): boolean {
  return option.options.some((candidate) => (
    "options" in candidate
      ? candidate.options.some((nested) => nested.value === value)
      : candidate.value === value
  ));
}

/** Replace a cached model catalog while retaining a still-valid selection. */
export function replaceCachedAcpModelCatalog(
  options: ACPConfigOption[],
  models: ACPConfigSelectOption[],
): ACPConfigOption[] {
  const normalized = normalizeCachedAcpConfigOptions(options);
  const seen = new Set<string>();
  const catalog = models.filter((model) => {
    const value = model.value.trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
  if (catalog.length === 0) return normalized;

  const modelIndex = normalized.findIndex((option) => (
    option.id === "model" || option.category === "model"
  ));
  const existing = modelIndex >= 0 ? normalized[modelIndex] : undefined;
  const currentValue = existing && catalog.some((model) => model.value === existing.currentValue)
    ? existing.currentValue
    : catalog[0].value;
  const modelOption: ACPConfigOption = {
    ...(existing ?? {}),
    id: existing?.id ?? "model",
    name: existing?.name ?? "Model",
    category: "model",
    type: "select",
    currentValue,
    options: catalog,
  };

  if (modelIndex < 0) return [modelOption, ...normalized];
  return normalized.map((option, index) => index === modelIndex ? modelOption : option);
}

/** Apply a refreshed dormant catalog without discarding session-local choices. */
export function reconcileCachedAcpConfigCatalog(
  current: ACPConfigOption[],
  refreshed: ACPConfigOption[],
): ACPConfigOption[] {
  const normalizedCurrent = normalizeCachedAcpConfigOptions(current);
  const normalizedRefreshed = normalizeCachedAcpConfigOptions(refreshed);
  if (normalizedRefreshed.length === 0) return normalizedCurrent;

  return normalizedRefreshed.map((option) => {
    const previous = normalizedCurrent.find((candidate) => candidate.id === option.id);
    if (!previous || !configOptionHasValue(option, previous.currentValue)) return option;
    return option.currentValue === previous.currentValue
      ? option
      : { ...option, currentValue: previous.currentValue };
  });
}

/** Keep only normalized ACP commands in the persisted draft catalog. */
export function normalizeCachedAcpSlashCommands(value: unknown): SlashCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((command): SlashCommand[] => {
    if (
      !isRecord(command)
      || typeof command.name !== "string"
      || command.name.trim().length === 0
      || typeof command.description !== "string"
    ) {
      return [];
    }
    return [{
      name: command.name,
      description: command.description,
      ...(typeof command.argumentHint === "string" ? { argumentHint: command.argumentHint } : {}),
      source: "acp",
    }];
  });
}

export function getAgentCachedSlashCommands(
  agents: readonly Pick<InstalledAgent, "id" | "cachedSlashCommands">[],
  agentId: string | null | undefined,
): SlashCommand[] {
  const normalizedId = agentId?.trim();
  if (!normalizedId) return [];
  const agent = agents.find((candidate) => candidate.id === normalizedId);
  return normalizeCachedAcpSlashCommands(agent?.cachedSlashCommands);
}

export function areAcpConfigOptionsEqual(
  left: readonly ACPConfigOption[],
  right: readonly ACPConfigOption[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((option, index) => (
    JSON.stringify(option) === JSON.stringify(right[index])
  ));
}

export function areAcpSlashCommandsEqual(
  left: readonly SlashCommand[],
  right: readonly SlashCommand[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((command, index) => (
    JSON.stringify(command) === JSON.stringify(right[index])
  ));
}
