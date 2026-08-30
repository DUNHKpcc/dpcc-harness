import { useCallback } from "react";
import type { McpServerConfig, Project } from "../../types";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { createSystemMessage } from "../../lib/message-factory";
import {
  DRAFT_ID,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks } from "./types";
import {
  BUILTIN_PI_AGENT_ID,
  getSessionRuntimeDisposition,
  INVALID_SESSION_ENGINE_MESSAGE,
  LEGACY_SESSION_READ_ONLY_MESSAGE,
} from "@shared/lib/session-runtime";

interface UseSessionRestartParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
}

export function useSessionRestart({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
}: UseSessionRestartParams) {
  const { acp } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setAcpMcpStatuses,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    messagesRef,
    totalCostRef,
    upstreamRequestCountRef,
    requestLogRef,
    contextUsageRef,
    isProcessingRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    acpAgentIdRef,
  } = refs;

  // ── Restart ACP session with updated MCP servers ──

  const restartAcpSession = useCallback(async (servers: McpServerConfig[], cwdOverride?: string): Promise<{ ok?: boolean; error?: string }> => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return { ok: true };

    const session = sessionsRef.current.find(s => s.id === currentId);
    const project = session ? findProject(session.projectId) : null;
    const disposition = getSessionRuntimeDisposition({
      engine: session?.invalidEngine ?? session?.engine,
      agentId: session?.agentId,
    });
    if (disposition.kind !== "runtime") {
      return {
        error: disposition.kind === "legacy-read-only"
          ? LEGACY_SESSION_READ_ONLY_MESSAGE
          : `${INVALID_SESSION_ENGINE_MESSAGE} (${disposition.engine})`,
      };
    }
    const agentId = acpAgentIdRef.current ?? disposition.agentId ?? BUILTIN_PI_AGENT_ID;
    if (!session || !project || !agentId) return { error: "ACP session cannot be restarted right now." };

    // Probe servers so we get accurate statuses (including needs-auth) before any reload
    const probeResults = await window.claude.mcp.probe(servers);
    // Guard: session may have changed during async probe
    if (activeSessionIdRef.current !== currentId) return { ok: true };
    setAcpMcpStatuses(probeResults.map(r => ({
      name: r.name,
      status: toMcpStatusState(r.status),
      ...(r.error ? { error: r.error } : {}),
    })));

    // Try session/load first — updates MCP on the existing connection, no context loss
    const nextCwd = cwdOverride ?? getProjectCwd(project);
    const reloadResult = await window.claude.acp.reloadSession(currentId, servers, nextCwd);
    if (reloadResult.supportsLoad && reloadResult.ok) {
      // session/load succeeded — session ID and process unchanged, context preserved
      return { ok: true };
    }

    // Fall back to stop + restart (agent doesn't support session/load, or reload failed)
    const currentMessages = messagesRef.current;
    const currentCost = totalCostRef.current;

    suppressNextSessionCompletion(currentId);
    await window.claude.acp.stop(currentId);
    liveSessionIdsRef.current.delete(currentId);
    backgroundStoreRef.current.delete(currentId);

    const result = await window.claude.acp.start({
      agentId,
      cwd: nextCwd,
      mcpServers: servers,
    });
    if (!("sessionId" in result) || !result.sessionId) {
      // Show error in the UI after restart failure — use setMessages directly
      // because session ID hasn't changed (no reset effect to consume initialMessages)
      const errorMsg = ("error" in result && result.error) ? result.error : "Failed to restart agent session";
      acp.setMessages(prev => [...prev, createSystemMessage(errorMsg, true)]);
      return { error: errorMsg };
    }

    const newId = result.sessionId;
    liveSessionIdsRef.current.add(newId);

    setSessions(prev => prev.map(s =>
      s.id === currentId ? { ...s, id: newId } : s
    ));
    // Restore UI message history and config options through initialMessages -> useACP reset effect
    setInitialMessages(currentMessages);
    setInitialMeta({
      isProcessing: false,
      isConnected: true,
      sessionInfo: null,
      totalCost: currentCost,
      upstreamRequestCount: upstreamRequestCountRef.current,
      requestLog: requestLogRef.current,
      contextUsage: contextUsageRef.current,
    });
    if ("configOptions" in result && result.configOptions?.length) setInitialConfigOptions(result.configOptions);
    setActiveSessionId(newId);
    return { ok: true };
  }, [findProject, getProjectCwd]);

  // ── Restart the active session in the current worktree ──

  const restartActiveSessionInCurrentWorktree = useCallback(async (): Promise<{ ok?: boolean; error?: string }> => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return { ok: true };
    if (isProcessingRef.current) {
      return { error: "Wait for the current turn to finish before restarting in another worktree." };
    }

    const session = sessionsRef.current.find((s) => s.id === currentId);
    if (!session) return { error: "Active session not found." };
    const disposition = getSessionRuntimeDisposition({
      engine: session.invalidEngine ?? session.engine,
      agentId: session.agentId,
    });
    if (disposition.kind !== "runtime") {
      return {
        error: disposition.kind === "legacy-read-only"
          ? LEGACY_SESSION_READ_ONLY_MESSAGE
          : `${INVALID_SESSION_ENGINE_MESSAGE} (${disposition.engine})`,
      };
    }
    const project = findProject(session.projectId);
    if (!project) return { error: "Project not found." };
    const nextCwd = getProjectCwd(project);
    const mcpServers = await window.claude.mcp.list();

    return restartAcpSession(mcpServers, nextCwd);
  }, [findProject, getProjectCwd, restartAcpSession]);

  return {
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
  };
}
