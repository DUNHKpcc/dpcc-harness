import type { ACPConfigOption } from "../types/acp";
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
