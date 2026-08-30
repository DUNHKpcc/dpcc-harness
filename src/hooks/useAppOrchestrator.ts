import { useCallback, useEffect, useState } from "react";
import { useProjectManager } from "@/hooks/useProjectManager";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSidebar } from "@/hooks/useSidebar";
import { useSpaceManager } from "@/hooks/useSpaceManager";
import { useSettingsCompat as useSettings } from "@/hooks/useSettingsCompat";
import { useTheme } from "@/hooks/useTheme";
import { useSpaceTerminals } from "@/hooks/useSpaceTerminals";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
import { useAcpAgentAutoUpdate } from "@/hooks/useAcpAgentAutoUpdate";
import { useSplitView } from "@/hooks/useSplitView";
import { useFolderManager } from "@/hooks/useFolderManager";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { ToolId } from "@/types/tools";
import { BUILTIN_PI_AGENT, BUILTIN_PI_AGENT_ID } from "@/types";
import type { EngineId, InstalledAgent } from "@/types";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppEnvironmentState } from "@/hooks/app-layout/useAppEnvironmentState";
import { useAppSessionActions } from "@/hooks/app-layout/useAppSessionActions";
import { useAppSpaceWorkflow } from "@/hooks/app-layout/useAppSpaceWorkflow";
import { useAppContextualPanels } from "@/hooks/app-layout/useAppContextualPanels";
import { getSessionRuntimeDisposition } from "@shared/lib/session-runtime";


interface UseAppOrchestratorInput {
  onOpenSession?: (sessionId: string) => void;
}

interface ToolTogglePlan {
  activeTools: Set<ToolId>;
  suppressPanel: ToolId | null;
  unsuppressPanel: ToolId | null;
}

export function planToolToggle(toolId: ToolId, activeTools: ReadonlySet<ToolId>): ToolTogglePlan {
  const isContextual = toolId === "tasks" || toolId === "agents";
  const next = new Set(activeTools);

  if (next.has(toolId)) {
    next.delete(toolId);
    return {
      activeTools: next,
      suppressPanel: isContextual ? toolId : null,
      unsuppressPanel: null,
    };
  }

  next.add(toolId);
  return {
    activeTools: next,
    suppressPanel: null,
    unsuppressPanel: isContextual ? toolId : null,
  };
}

export function useAppOrchestrator(input: UseAppOrchestratorInput = {}) {
  const sidebar = useSidebar();
  const splitView = useSplitView();
  const projectManager = useProjectManager();
  const spaceManager = useSpaceManager();
  const agentRegistry = useAgentRegistry();
  const acpPermissionBehavior = useSettingsStore((state) => state.acpPermissionBehavior);
  const manager = useSessionManager(
    projectManager.projects,
    acpPermissionBehavior,
    spaceManager.setActiveSpaceId,
    splitView.visibleSessionIds,
    agentRegistry.agents,
  );

  const [selectedAgent, setSelectedAgent] = useState<InstalledAgent | null>(() => ({
    ...BUILTIN_PI_AGENT,
  }));
  // Settings are now scoped to the sole live runtime. Legacy session identity
  // remains visible through `lockedEngine`, but must not select old model
  // catalogs or old runtime controls.
  const settingsEngine: EngineId = "acp";
  const settingsProjectId = manager.activeSession?.projectId ?? manager.draftProjectId ?? null;
  const settings = useSettings(settingsProjectId, settingsEngine);
  const resolvedTheme = useTheme(settings.theme);
  const { agents, refresh: refreshAgents, saveAgent, deleteAgent } = agentRegistry;
  useAcpAgentAutoUpdate({ installedAgents: agents, refreshInstalledAgents: refreshAgents });
  const activeSessionDisposition = !manager.isDraft && manager.activeSession
    ? getSessionRuntimeDisposition({
        engine: manager.activeSession.invalidEngine ?? manager.activeSession.engine,
        agentId: manager.activeSession.agentId,
      })
    : null;
  // Engine is locked once a session is active (not draft) — null means free to switch
  const lockedEngine: EngineId | null = activeSessionDisposition
    ? activeSessionDisposition.kind === "legacy-read-only"
      ? activeSessionDisposition.engine
      : "acp"
    : null;
  const readOnlyReason: "legacy" | "invalid" | null = activeSessionDisposition?.kind === "legacy-read-only"
    ? "legacy"
    : activeSessionDisposition?.kind === "invalid"
      ? "invalid"
      : null;

  // Agent ID is locked for ACP sessions — switching agents must open a new chat
  const lockedAgentId = !manager.isDraft && manager.activeSession?.agentId
    ? manager.activeSession.agentId
    : null;
  const spaceTerminals = useSpaceTerminals();

  // ── Tool toggle with suppression ──

  const handleToggleTool = useCallback(
    (toolId: ToolId) => {
      const plan = planToolToggle(toolId, settings.activeTools);
      settings.setActiveTools(plan.activeTools);
      if (plan.suppressPanel) settings.suppressPanel(plan.suppressPanel);
      if (plan.unsuppressPanel) settings.unsuppressPanel(plan.unsuppressPanel);
    },
    [settings],
  );

  const handleCloseTasksPanel = useCallback(() => {
    settings.setActiveTools((prev) => {
      if (!prev.has("tasks")) return prev;
      const next = new Set(prev);
      next.delete("tasks");
      return next;
    });
    settings.suppressPanel("tasks");
  }, [settings]);

  // Reorder panel tools in the ToolPicker (moves fromId to toId's position)
  const handleToolReorder = useCallback(
    (fromId: ToolId, toId: ToolId) => {
      settings.setToolOrder((prev) => {
        const next = [...prev];
        const fromIdx = next.indexOf(fromId);
        const toIdx = next.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) return prev;
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, fromId);
        return next;
      });
    },
    [settings],
  );
  const environment = useAppEnvironmentState({
    macBackgroundEffect: settings.macBackgroundEffect,
    setMacBackgroundEffect: settings.setMacBackgroundEffect,
    transparency: settings.transparency,
    theme: settings.theme,
    pendingPermission: manager.pendingPermission,
    activeSessionId: manager.activeSessionId,
    activeSession: manager.activeSession,
    sessionInfo: manager.sessionInfo,
    isProcessing: manager.isProcessing,
    visibleSessionIds: splitView.visibleSessionIds,
    onOpenSession: input.onOpenSession ?? manager.switchSession,
  });

  const sessionActions = useAppSessionActions({
    manager,
    settings,
    selectedAgent,
    installedAgents: agents,
    setSelectedAgent,
    setShowSettings: environment.setShowSettings,
    refreshAgents,
    activeSpaceId: spaceManager.activeSpaceId,
    projectManager,
  });

  const spaceWorkflow = useAppSpaceWorkflow({
    projectManager,
    spaceManager,
    manager,
    splitView,
    handleNewChat: sessionActions.handleNewChat,
    destroySpaceTerminals: spaceTerminals.destroySpaceTerminals,
  });

  const contextualState = useAppContextualPanels({
    manager,
    settings,
    isSpaceSwitching: spaceWorkflow.isSpaceSwitching,
  });

  // Sync selectedAgent when switching to a different session
  useEffect(() => {
    if (!manager.activeSessionId || manager.isDraft) return;
    const session = manager.sessions.find((s) => s.id === manager.activeSessionId);
    if (!session) return;

    const disposition = getSessionRuntimeDisposition({
      engine: session.invalidEngine ?? session.engine,
      agentId: session.agentId,
    });
    if (disposition.kind === "runtime") {
      const agentId = disposition.agentId;
      const agent = agents.find((a) => a.id === agentId)
        ?? (agentId === BUILTIN_PI_AGENT_ID ? BUILTIN_PI_AGENT : undefined);
      if (agent && selectedAgent?.id !== agent.id) {
        setSelectedAgent(agent);
      }
      return;
    }

    if (selectedAgent?.id !== BUILTIN_PI_AGENT_ID) {
      setSelectedAgent(agents.find((agent) => agent.id === BUILTIN_PI_AGENT_ID) ?? BUILTIN_PI_AGENT);
    }
  }, [manager.activeSessionId, manager.isDraft, manager.sessions, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ──
  useKeyboardShortcuts({
    activeSessionId: manager.activeSessionId,
    setChatSearchOpen: environment.setChatSearchOpen,
  });

  const activeSpaceTerminals = spaceTerminals.getSpaceState(spaceManager.activeSpaceId);

  // ── Folder & Pin management ──
  const folders = useFolderManager({
    projects: projectManager.projects,
    setSessions: manager.setSessions,
  });

  const ui = {
    showSettings: environment.showSettings,
    setShowSettings: environment.setShowSettings,
    scrollToMessageId: environment.scrollToMessageId,
    setScrollToMessageId: environment.setScrollToMessageId,
    chatSearchOpen: environment.chatSearchOpen,
    setChatSearchOpen: environment.setChatSearchOpen,
  };

  const state = {
    activeProjectId: spaceWorkflow.activeProjectId,
    activeProject: spaceWorkflow.activeProject,
    activeProjectPath: spaceWorkflow.activeProjectPath,
    activeSpaceProject: spaceWorkflow.activeSpaceProject,
    activeSpaceTerminalCwd: spaceWorkflow.activeSpaceTerminalCwd,
    showThinking: true as const,
    settingsEngine,
    hasProjects: spaceWorkflow.hasProjects,
    isSpaceSwitching: spaceWorkflow.isSpaceSwitching,
    showToolPicker: contextualState.showToolPicker,
    hasRightPanel: contextualState.hasRightPanel,
    hasToolsColumn: contextualState.hasToolsColumn,
    hasBottomTools: contextualState.hasBottomTools,
    activeTodos: contextualState.activeTodos,
    bgAgents: contextualState.bgAgents,
    hasTodos: contextualState.hasTodos,
    hasAgents: contextualState.hasAgents,
    availableContextual: contextualState.availableContextual,
    glassSupported: environment.glassSupported,
    macLiquidGlassSupported: environment.macLiquidGlassSupported,
    liveMacBackgroundEffect: environment.liveMacBackgroundEffect,
    devFillEnabled: environment.devFillEnabled,
    jiraBoardEnabled: environment.jiraBoardEnabled,
    draftSpaceId: spaceWorkflow.draftSpaceId,
  };

  const agentState = {
    agents,
    selectedAgent,
    saveAgent,
    deleteAgent,
    handleAgentChange: sessionActions.handleAgentChange,
    lockedEngine,
    lockedAgentId,
    readOnlyReason,
  };

  const actions = {
    handleToggleTool,
    handleCloseTasksPanel,
    handleToolReorder,
    handleNewChat: sessionActions.handleNewChat,
    handleSend: sessionActions.handleSend,
    handleAgentWorktreeChange: sessionActions.handleAgentWorktreeChange,
    handleStop: sessionActions.handleStop,
    handleSendQueuedNow: sessionActions.handleSendQueuedNow,
    handleUnqueueMessage: sessionActions.handleUnqueueMessage,
    handleSelectSession: sessionActions.handleSelectSession,
    handleCreateProject: sessionActions.handleCreateProject,
    handleImportCCSession: sessionActions.handleImportCCSession,
    handleSeedDevExampleSpaceData: sessionActions.handleSeedDevExampleSpaceData,
    handleNavigateToMessage: (sessionId: string, messageId: string) => sessionActions.handleNavigateToMessage(sessionId, environment.setScrollToMessageId, messageId),
    handleStartCreateSpace: spaceWorkflow.handleStartCreateSpace,
    handleConfirmCreateSpace: spaceWorkflow.handleConfirmCreateSpace,
    handleCancelCreateSpace: spaceWorkflow.handleCancelCreateSpace,
    handleUpdateSpace: spaceWorkflow.handleUpdateSpace,
    handleDeleteSpace: spaceWorkflow.handleDeleteSpace,
    handleMoveProjectToSpace: spaceWorkflow.handleMoveProjectToSpace,
    ...folders,
  };

  const managers = {
    sidebar,
    splitView,
    projectManager,
    spaceManager,
    manager,
    settings,
    resolvedTheme,
    spaceTerminals,
    activeSpaceTerminals,
  };

  return {
    managers,
    state,
    ui,
    agentState,
    actions,

    // Core managers
    sidebar,
    splitView,
    projectManager,
    spaceManager,
    manager,
    settings,
    resolvedTheme,

    // Agent state
    agents,
    selectedAgent,
    saveAgent,
    deleteAgent,
    handleAgentChange: sessionActions.handleAgentChange,
    lockedEngine,
    lockedAgentId,
    readOnlyReason,

    // Derived state
    activeProjectId: spaceWorkflow.activeProjectId,
    activeProject: spaceWorkflow.activeProject,
    activeProjectPath: spaceWorkflow.activeProjectPath,
    activeSpaceProject: spaceWorkflow.activeSpaceProject,
    activeSpaceTerminalCwd: spaceWorkflow.activeSpaceTerminalCwd,
    showThinking: true as const,
    settingsEngine,
    hasProjects: spaceWorkflow.hasProjects,
    isSpaceSwitching: spaceWorkflow.isSpaceSwitching,
    showToolPicker: contextualState.showToolPicker,
    hasRightPanel: contextualState.hasRightPanel,
    hasToolsColumn: contextualState.hasToolsColumn,
    hasBottomTools: contextualState.hasBottomTools,
    activeTodos: contextualState.activeTodos,
    bgAgents: contextualState.bgAgents,
    hasTodos: contextualState.hasTodos,
    hasAgents: contextualState.hasAgents,
    availableContextual: contextualState.availableContextual,
    glassSupported: environment.glassSupported,
    macLiquidGlassSupported: environment.macLiquidGlassSupported,
    liveMacBackgroundEffect: environment.liveMacBackgroundEffect,
    devFillEnabled: environment.devFillEnabled,
    jiraBoardEnabled: environment.jiraBoardEnabled,

    // Settings view
    showSettings: ui.showSettings,
    setShowSettings: ui.setShowSettings,

    // Space management (draft = real space, deleted on cancel)
    draftSpaceId: state.draftSpaceId,

    // Scroll navigation
    scrollToMessageId: ui.scrollToMessageId,
    setScrollToMessageId: ui.setScrollToMessageId,

    // In-chat search
    chatSearchOpen: ui.chatSearchOpen,
    setChatSearchOpen: ui.setChatSearchOpen,

    // Terminals
    spaceTerminals,
    activeSpaceTerminals,

    // Callbacks
    handleToggleTool,
    handleCloseTasksPanel,
    handleToolReorder,
    handleNewChat: sessionActions.handleNewChat,
    handleSend: sessionActions.handleSend,
    handleAgentWorktreeChange: sessionActions.handleAgentWorktreeChange,
    handleStop: sessionActions.handleStop,
    handleSendQueuedNow: sessionActions.handleSendQueuedNow,
    handleUnqueueMessage: sessionActions.handleUnqueueMessage,
    handleSelectSession: sessionActions.handleSelectSession,
    handleCreateProject: sessionActions.handleCreateProject,
    handleImportCCSession: sessionActions.handleImportCCSession,
    handleSeedDevExampleSpaceData: sessionActions.handleSeedDevExampleSpaceData,
    handleNavigateToMessage: (sessionId: string, messageId: string) => sessionActions.handleNavigateToMessage(sessionId, environment.setScrollToMessageId, messageId),
    handleStartCreateSpace: spaceWorkflow.handleStartCreateSpace,
    handleConfirmCreateSpace: spaceWorkflow.handleConfirmCreateSpace,
    handleCancelCreateSpace: spaceWorkflow.handleCancelCreateSpace,
    handleUpdateSpace: spaceWorkflow.handleUpdateSpace,
    handleDeleteSpace: spaceWorkflow.handleDeleteSpace,
    handleMoveProjectToSpace: spaceWorkflow.handleMoveProjectToSpace,

    // Folder & Pin management
    ...folders,
  };
}
