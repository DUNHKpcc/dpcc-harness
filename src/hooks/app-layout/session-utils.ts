import type { EngineId, InstalledAgent } from "@/types";
import { DEFAULT_PERMISSION_MODE, type StartOptions } from "@/hooks/session/types";
import { CHAT_MODULE_PROJECT_ID } from "@/lib/session/chat-module";
import { normalizeNewSessionIdentity } from "@shared/lib/session-runtime";

/** Build common session-creation options from current settings and agent state. */
export function buildSessionOptions(
  engine: EngineId,
  getModelForEngine: (engine: EngineId) => string | null,
  agent: InstalledAgent | null,
): StartOptions {
  // Persisted legacy sessions are handled by runtime disposition guards. This
  // creation boundary always resolves to ACP/Pi or an explicit custom ACP agent.
  const selectedAgent = agent?.engine === "acp" ? agent : null;
  const identity = normalizeNewSessionIdentity({
    engine: selectedAgent ? "acp" : engine,
    agentId: selectedAgent?.id,
  });
  const model = getModelForEngine("acp") || undefined;
  return {
    model,
    permissionMode: DEFAULT_PERMISSION_MODE,
    planMode: false,
    effort: undefined,
    engine: identity.engine,
    agentId: identity.agentId,
    cachedConfigOptions: selectedAgent?.cachedConfigOptions,
    cachedSlashCommands: selectedAgent?.cachedSlashCommands,
  };
}

export function resolveComposerClearProjectId(projectId: string | null | undefined): string {
  return projectId?.trim() || CHAT_MODULE_PROJECT_ID;
}
