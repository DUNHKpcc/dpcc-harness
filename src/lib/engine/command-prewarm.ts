import type { ACPAvailableCommand, SlashCommand } from "@/types";

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

export function normalizeAcpCommands(commands: ACPAvailableCommand[]): SlashCommand[] {
  return commands.map((command) => ({
    name: command.name,
    description: command.description ?? "",
    argumentHint: command.input?.hint,
    source: "acp" as const,
  }));
}
