import type { ACPAvailableCommand, SlashCommand } from "@/types";
import type { AppInfo } from "@shared/types/codex-protocol/v2/AppInfo";
import type { SkillsListEntry } from "@shared/types/codex-protocol/v2/SkillsListEntry";

export interface CodexCommandCatalog {
  skills?: SkillsListEntry[];
  apps?: AppInfo[];
}

const CODEX_NATIVE_COMMANDS: SlashCommand[] = [
  {
    name: "new",
    description: "Start a new chat",
    source: "codex-native",
  },
  {
    name: "compact",
    description: "Summarize the conversation to free context",
    source: "codex-native",
  },
  {
    name: "model",
    description: "Choose the model and reasoning effort",
    argumentHint: "<model>",
    source: "codex-native",
  },
  {
    name: "permissions",
    description: "Choose what Codex is allowed to do",
    argumentHint: "<mode>",
    source: "codex-native",
  },
  {
    name: "plan",
    description: "Switch to Plan mode",
    source: "codex-native",
  },
];

/**
 * Codex TUI slash commands are client-side actions, not entries returned by
 * app-server's skills/list or app/list APIs. Keep the subset PccAgent can
 * execute in one catalog so it can be composed with prewarmed SDK commands.
 */
export function getCodexNativeCommands(hasActiveSession: boolean): SlashCommand[] {
  return CODEX_NATIVE_COMMANDS.map((command) => (
    command.name === "compact" && !hasActiveSession
      ? {
          ...command,
          disabled: true,
          description: "Available after the first Codex message",
        }
      : command
  ));
}

/** Load a native command catalog without letting an optional prewarm failure block a draft. */
export async function prewarmSessionCommands<T>(
  load: () => Promise<T>,
  normalize: (value: T) => SlashCommand[],
): Promise<SlashCommand[]> {
  try {
    return normalize(await load());
  } catch {
    return [];
  }
}

export function normalizeClaudeCommands(result: {
  commands?: Array<{
    name: string;
    description?: string;
    argumentHint?: string;
  }>;
}): SlashCommand[] {
  return (result.commands ?? []).map((command) => ({
    name: command.name,
    description: command.description ?? "",
    argumentHint: command.argumentHint,
    source: "claude" as const,
  }));
}

export function normalizeAcpCommands(commands: ACPAvailableCommand[]): SlashCommand[] {
  return commands.map((command) => ({
    name: command.name,
    description: command.description ?? "",
    argumentHint: command.input?.hint,
    source: "acp" as const,
  }));
}

export function normalizeCodexCommands(catalog: CodexCommandCatalog): SlashCommand[] {
  const commands: SlashCommand[] = [];
  const skillNames = new Set<string>();
  const appIds = new Set<string>();
  for (const entry of catalog.skills ?? []) {
    for (const skill of entry.skills ?? []) {
      // Multiple skill roots can expose the same $name. Codex resolves it by
      // name, so presenting it once avoids duplicate picker entries.
      if (!skill.enabled || skillNames.has(skill.name)) continue;
      skillNames.add(skill.name);
      commands.push({
        name: skill.name,
        description: skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description,
        source: "codex-skill",
        defaultPrompt: skill.interface?.defaultPrompt,
        iconUrl: skill.interface?.iconSmall,
      });
    }
  }
  for (const app of catalog.apps ?? []) {
    if (!app.isEnabled || !app.isAccessible || appIds.has(app.id)) continue;
    appIds.add(app.id);
    commands.push({
      name: app.name,
      description: app.description ?? "",
      source: "codex-app",
      appSlug: app.id,
      iconUrl: app.logoUrl ?? undefined,
    });
  }
  return commands;
}
