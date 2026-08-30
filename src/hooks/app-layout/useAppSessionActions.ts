import { useCallback, useEffect } from "react";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSettingsCompat } from "@/hooks/useSettingsCompat";
import { BUILTIN_PI_AGENT } from "@/types";
import type { FileReference, ImageAttachment, InstalledAgent } from "@/types";
import type { SettingsSection } from "@/components/SettingsView";
import { selectProjectModelForEngine, useSettingsStore } from "@/stores/settings-store";
import { buildSessionOptions } from "./session-utils";
import {
  areAcpSlashCommandsEqual,
  areAcpConfigOptionsEqual,
  getAgentCachedConfigOptions,
  getAgentCachedSlashCommands,
} from "@shared/lib/acp-config-cache";

type SessionManagerState = ReturnType<typeof useSessionManager>;
type SettingsState = ReturnType<typeof useSettingsCompat>;
type ProjectManagerState = ReturnType<typeof useProjectManager>;

interface UseAppSessionActionsInput {
  manager: SessionManagerState;
  settings: SettingsState;
  selectedAgent: InstalledAgent | null;
  installedAgents: readonly InstalledAgent[];
  setSelectedAgent: (agent: InstalledAgent | null) => void;
  setShowSettings: (show: SettingsSection | false) => void;
  refreshAgents: () => Promise<void> | void;
  activeSpaceId: string;
  projectManager: Pick<ProjectManagerState, "projects" | "createProject" | "createDevProject">;
}

export function useAppSessionActions(input: UseAppSessionActionsInput) {
  const selectedAgent = input.selectedAgent?.engine === "acp"
    ? input.selectedAgent
    : BUILTIN_PI_AGENT;

  const handleAgentWorktreeChange = useCallback((nextPath: string | null) => {
    input.settings.setGitCwd(nextPath);

    if (input.manager.activeSessionId && !input.manager.isDraft && input.manager.activeSession) {
      const engine = "acp" as const;
      const options = buildSessionOptions(
        engine,
        input.settings.getModelForEngine,
        selectedAgent,
      );
      void input.manager.createSession(input.manager.activeSession.projectId, {
        ...options,
        agentId: selectedAgent.id,
      });
    }
  }, [input.manager, input.settings, selectedAgent]);

  const handleAgentChange = useCallback((agent: InstalledAgent | null) => {
    const nextAgent = agent?.engine === "acp" ? agent : BUILTIN_PI_AGENT;
    input.setSelectedAgent(nextAgent);

    const currentEngine = input.manager.activeSession?.engine;
    const currentAgentId = input.manager.activeSession?.agentId;
    const wantedEngine = "acp" as const;
    const needsNewSession = !input.manager.isDraft && input.manager.activeSession && (
      currentEngine !== wantedEngine ||
      (currentEngine === "acp" && currentAgentId !== nextAgent.id)
    );

    if (needsNewSession) {
      const options = buildSessionOptions(
        wantedEngine,
        input.settings.getModelForEngine,
        nextAgent,
      );
      void input.manager.createSession(input.manager.activeSession!.projectId, options);
      return;
    }

    const wantedModel = input.settings.getModelForEngine(wantedEngine);
    input.manager.setDraftAgent(
      wantedEngine,
      nextAgent.id,
      nextAgent.cachedConfigOptions,
      wantedModel || undefined,
      nextAgent.cachedSlashCommands,
    );
  }, [input.manager, input.settings, input.setSelectedAgent]);

  const handleNewChat = useCallback(async (projectId: string) => {
    input.setShowSettings(false);
    const wantedEngine = "acp" as const;
    const settingsState = useSettingsStore.getState();
    const options = buildSessionOptions(
      wantedEngine,
      (engine) => selectProjectModelForEngine(
        settingsState,
        projectId,
        engine,
      ),
      selectedAgent,
    );
    await input.manager.createSession(projectId, options);
  }, [input.manager, input.setShowSettings, selectedAgent]);

  const handleSend = useCallback(async (text: string, images?: ImageAttachment[], displayText?: string, fileReferences?: FileReference[]) => {
    const wantedEngine = "acp" as const;
    // A legacy session stays read-only. Do not silently create Pi and pretend
    // the message continued in the old conversation.
    const needsNewSession = !input.manager.isDraft
      && input.manager.activeSession?.engine === "acp"
      && input.manager.activeSession.agentId !== selectedAgent.id;
    if (needsNewSession) {
      const options = buildSessionOptions(
        wantedEngine,
        input.settings.getModelForEngine,
        selectedAgent,
      );
      await input.manager.createSession(input.manager.activeSession!.projectId, options);
    }
    await input.manager.send(text, images, displayText, fileReferences);
  }, [input.manager, input.settings, selectedAgent]);

  const handleStop = useCallback(async () => {
    await input.manager.interrupt();
  }, [input.manager]);

  const handleSendQueuedNow = useCallback(async (messageId: string) => {
    await input.manager.sendQueuedMessageNext(messageId);
  }, [input.manager]);

  const handleUnqueueMessage = useCallback((messageId: string) => {
    input.manager.unqueueMessage(messageId);
  }, [input.manager]);

  const handleSelectSession = useCallback((sessionId: string) => {
    input.setShowSettings(false);
    input.manager.switchSession(sessionId);
  }, [input.manager, input.setShowSettings]);

  const handleCreateProject = useCallback(async () => {
    input.setShowSettings(false);
    await input.projectManager.createProject(input.activeSpaceId);
  }, [input.activeSpaceId, input.projectManager, input.setShowSettings]);

  const handleImportCCSession = useCallback(async (projectId: string, ccSessionId: string) => {
    await input.manager.importCCSession(projectId, ccSessionId);
  }, [input.manager]);

  const handleSeedDevExampleSpaceData = useCallback(async () => {
    if (!import.meta.env.DEV) return;
    const { seedDevExampleSpaceData } = await import("@/lib/dev-seeding/space-seeding");
    await seedDevExampleSpaceData({
      activeSpaceId: input.activeSpaceId,
      existingProjects: input.projectManager.projects,
      createDevProject: input.projectManager.createDevProject,
      saveSession: window.claude.sessions.save,
      refreshSessions: input.manager.refreshSessions,
    });
  }, [input.activeSpaceId, input.manager.refreshSessions, input.projectManager.createDevProject, input.projectManager.projects]);

  const handleNavigateToMessage = useCallback((sessionId: string, setScrollToMessageId: (messageId: string) => void, messageId: string) => {
    input.manager.switchSession(sessionId);
    setTimeout(() => setScrollToMessageId(messageId), 200);
  }, [input.manager]);

  useEffect(() => {
    const agentId = input.manager.activeSession?.agentId;
    if (
      !agentId
      || input.manager.activeSession?.engine !== "acp"
      || !input.manager.isConnected
    ) return;

    const cachedConfigOptions = getAgentCachedConfigOptions(input.installedAgents, agentId);
    const cachedSlashCommands = getAgentCachedSlashCommands(input.installedAgents, agentId);
    const updates: Array<Promise<{ ok?: boolean }>> = [];

    if (
      input.manager.acpConfigOptions.length > 0
      && !areAcpConfigOptionsEqual(cachedConfigOptions, input.manager.acpConfigOptions)
    ) {
      updates.push(window.claude.agents.updateCachedConfig(agentId, input.manager.acpConfigOptions));
    }
    if (
      input.manager.slashCommands.length > 0
      && !areAcpSlashCommandsEqual(cachedSlashCommands, input.manager.slashCommands)
    ) {
      updates.push(window.claude.agents.updateCachedSlashCommands(agentId, input.manager.slashCommands));
    }
    if (updates.length === 0) return;

    Promise.all(updates)
      .then(() => input.refreshAgents());
  }, [
    input.installedAgents,
    input.manager.acpConfigOptions,
    input.manager.activeSession,
    input.manager.isConnected,
    input.manager.slashCommands,
    input.refreshAgents,
  ]);

  return {
    handleAgentWorktreeChange,
    handleAgentChange,
    handleNewChat,
    handleSend,
    handleStop,
    handleSendQueuedNow,
    handleUnqueueMessage,
    handleSelectSession,
    handleCreateProject,
    handleImportCCSession,
    handleSeedDevExampleSpaceData,
    handleNavigateToMessage,
  };
}
