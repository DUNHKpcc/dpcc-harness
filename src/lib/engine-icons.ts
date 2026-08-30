import type { InstalledAgent } from "@/types";
import { BUILTIN_PI_AGENT_ID, PI_OFFICIAL_ICON } from "@/types";
import type { EngineId } from "@shared/types/engine";

/** CDN icons for built-in engines; ACP agents use their own `icon` field */
export const ENGINE_ICONS: Record<string, string> = {
  claude: "https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg",
  codex: "https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg",
};

/** Resolve the icon source for an agent — engine CDN icons override agent-level icons */
export function getAgentIcon(agent: InstalledAgent): string | undefined {
  if (agent.id === BUILTIN_PI_AGENT_ID) return PI_OFFICIAL_ICON;
  return ENGINE_ICONS[agent.engine] ?? agent.icon;
}

/** Resolve the icon URL for a session based on its engine and optional agent ID */
export function getSessionEngineIcon(
  engine: EngineId | undefined,
  agentId: string | undefined,
  agents?: InstalledAgent[],
): string | undefined {
  if (!engine) return undefined;
  if (engine !== "acp") {
    return ENGINE_ICONS[engine];
  }
  if (!agentId || agentId === BUILTIN_PI_AGENT_ID) {
    return PI_OFFICIAL_ICON;
  }
  if (agentId && agents) {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) return getAgentIcon(agent);
  }
  return undefined;
}
