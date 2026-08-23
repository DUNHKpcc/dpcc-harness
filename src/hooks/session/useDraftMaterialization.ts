import { useCallback, useRef } from "react";
import { toast } from "sonner";
import type { UIMessage, ChatSession, McpServerConfig, Project, ImageAttachment, EngineId, SlashCommand } from "../../types";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { captureException } from "../../lib/analytics/analytics";
import { toastText } from "../../lib/toast-i18n";
import { isClaudeModelCacheRequestCurrent } from "../../lib/engine/claude-model-request";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import {
  DRAFT_ID,
  getEffectiveClaudePermissionMode,
  getCodexApprovalPolicy,
  getCodexSandboxMode,
  normalizeCodexModels,
  pickCodexModel,
} from "./types";
import {
  normalizeAcpCommands,
  normalizeClaudeCommands,
  normalizeCodexCommands,
  prewarmSessionCommands,
} from "../../lib/engine/command-prewarm";
import type {
  EngineHooks,
  MaterializedDraftSession,
  SharedSessionRefs,
  SharedSessionSetters,
  StartOptions,
} from "./types";

interface UseDraftMaterializationParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
  generateSessionTitle: (sessionId: string, message: string, projectPath: string, engine?: EngineId) => Promise<void>;
  applyCodexModelDefaultEffort: (effort: string | undefined) => void;
}

interface CodexDraftCommandPrewarm {
  initial: Promise<SlashCommand[]>;
  complete: Promise<SlashCommand[]>;
}

export function useDraftMaterialization({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
  generateSessionTitle,
  applyCodexModelDefaultEffort,
}: UseDraftMaterializationParams) {
  const { claude, acp, codex } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setInitialSlashCommands,
    setInitialPermission,
    setInitialRawAcpPermission,
    setStartOptions,
    setDraftProjectId,
    setPreStartedSessionId,
    setDraftAcpSessionId,
    setAcpConfigOptionsLoading,
    setDraftMcpStatuses,
    setAcpMcpStatuses,
    setCachedModels,
    setCodexRawModels,
    setCodexModelsLoadingMessage,
  } = setters;
  const {
    activeSessionIdRef,
    draftProjectIdRef,
    startOptionsRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    preStartedSessionIdRef,
    draftAcpSessionIdRef,
    draftMcpStatusesRef,
    materializingRef,
    pendingAcpDraftPromptRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
    codexRawModelsRef,
    draftGenerationRef,
    claudeModelCatalogRequestGenerationRef,
    claudeEagerStartGenerationRef,
  } = refs;
  const materializingGenerationRef = useRef<number | null>(null);
  const acpEagerStartGenerationRef = useRef(0);
  const commandPrewarmBySessionRef = useRef(new Map<string, Promise<void>>());
  const codexCommandCatalogByCwdRef = useRef(new Map<string, CodexDraftCommandPrewarm>());

  const isCurrentDraftTarget = useCallback((
    projectId: string,
    engine: EngineId,
    agentId?: string,
  ) => (
    activeSessionIdRef.current === DRAFT_ID
    && draftProjectIdRef.current === projectId
    && (startOptionsRef.current.engine ?? "claude") === engine
    && (agentId === undefined || startOptionsRef.current.agentId === agentId)
  ), []);

  // Eagerly start a Claude SDK session for immediate MCP status display
  const eagerStartSession = useCallback(async (projectId: string, options?: StartOptions) => {
    const eagerStartGeneration = ++claudeEagerStartGenerationRef.current;
    const isCurrentEagerStart = () => eagerStartGeneration === claudeEagerStartGenerationRef.current;
    const discardStartedSession = (sessionId: string) => {
      suppressNextSessionCompletion(sessionId);
      window.claude.stop(sessionId, "draft_abandoned");
      liveSessionIdsRef.current.delete(sessionId);
      backgroundStoreRef.current.delete(sessionId);
      commandPrewarmBySessionRef.current.delete(sessionId);
      if (preStartedSessionIdRef.current === sessionId) {
        preStartedSessionIdRef.current = null;
        setPreStartedSessionId(null);
        setDraftMcpStatuses([]);
      }
    };
    // The global Chat module is a virtual project, resolved by findProject().
    const project = findProject(projectId) ?? refs.projectsRef.current.find((p) => p.id === projectId);
    if (!project) return;
    let mcpServers: McpServerConfig[];
    try {
      mcpServers = await window.claude.mcp.list(projectId);
    } catch (err) {
      if (isCurrentEagerStart()) {
        captureException(err instanceof Error ? err : new Error(String(err)), {
          label: "EAGER_MCP_LIST_ERR",
        });
      }
      return;
    }
    if (!isCurrentEagerStart()) return;
    let result;
    try {
      result = await window.claude.start({
        cwd: getProjectCwd(project),
        model: options?.model,
        permissionMode: getEffectiveClaudePermissionMode(options ?? {}),
        thinkingEnabled: options?.thinkingEnabled,
        effort: options?.effort,
        claudeCodexBridgeEnabled: options?.claudeCodexBridgeEnabled,
        mcpServers,
      });
    } catch (err) {
      captureException(err instanceof Error ? err : new Error(String(err)), { label: "EAGER_START_ERR" });
      console.warn("[eagerStartSession] start() failed:", err);
      return; // Eager start is optional — will fall back to normal start in materializeDraft
    }
    if (result.error) {
      console.warn("[eagerStartSession] start() returned error:", result.error);
      return;
    }
    if (!isCurrentEagerStart() || !isCurrentDraftTarget(projectId, "claude", options?.agentId)) {
      // The draft was abandoned or superseded before eager start completed.
      discardStartedSession(result.sessionId);
      return;
    }

    liveSessionIdsRef.current.add(result.sessionId);
    preStartedSessionIdRef.current = result.sessionId;
    setPreStartedSessionId(result.sessionId);

    // The init event can arrive before the renderer claims the draft session.
    // Fetch the full command catalog directly and keep the promise so the first
    // send can wait for it before consuming the pre-started session state.
    const commandPrewarm = prewarmSessionCommands(
      () => window.claude.slashCommands(result.sessionId),
      normalizeClaudeCommands,
    ).then((commands) => {
      if (
        !isCurrentEagerStart()
        || !isCurrentDraftTarget(projectId, "claude", options?.agentId)
        || preStartedSessionIdRef.current !== result.sessionId
      ) return;
      backgroundStoreRef.current.setSlashCommands?.(result.sessionId, commands);
      setInitialSlashCommands(commands);
    });
    commandPrewarmBySessionRef.current.set(result.sessionId, commandPrewarm);
    void commandPrewarm;

    // The system init event fires BEFORE start() returns, so the event router
    // couldn't match it (preStartedSessionIdRef was still null). Query MCP
    // status directly now that the session is initialized.
    const statusResult = await window.claude.mcpStatus(result.sessionId);
    if (!isCurrentEagerStart() || !isCurrentDraftTarget(projectId, "claude", options?.agentId)) {
      discardStartedSession(result.sessionId);
      return;
    }
    if (statusResult.servers?.length
      && preStartedSessionIdRef.current === result.sessionId) {
      setDraftMcpStatuses(statusResult.servers.map(s => ({
        name: s.name,
        status: toMcpStatusState(s.status),
      })));
    }

    // Same pattern for models — fetch directly since system/init already fired.
    // Catalog ordering remains independent from eager start transaction ordering.
    if (
      !isCurrentEagerStart()
      || !isCurrentDraftTarget(projectId, "claude", options?.agentId)
      || preStartedSessionIdRef.current !== result.sessionId
    ) return;
    const modelsGeneration = ++claudeModelCatalogRequestGenerationRef.current;
    const modelsResult = await window.claude.supportedModels(result.sessionId);
    if (!modelsResult.error
      && !modelsResult.stale
      && isCurrentEagerStart()
      && isCurrentDraftTarget(projectId, "claude", options?.agentId)
      && preStartedSessionIdRef.current === result.sessionId
      && isClaudeModelCacheRequestCurrent(
        modelsGeneration,
        claudeModelCatalogRequestGenerationRef.current,
      )) {
      setCachedModels(modelsResult.models, modelsResult.authoritative);
    }
  }, [isCurrentDraftTarget]);

  const eagerStartAcpSession = useCallback(async (
    projectId: string,
    options?: StartOptions,
    overrideServers?: McpServerConfig[],
  ) => {
    const eagerStartGeneration = ++acpEagerStartGenerationRef.current;
    const isCurrentEagerStart = () => (
      eagerStartGeneration === acpEagerStartGenerationRef.current
    );
    const project = findProject(projectId);
    const agentId = options?.agentId?.trim();
    if (!project || !agentId) return;

    let mcpServers: McpServerConfig[];
    let result;
    setAcpConfigOptionsLoading(true);
    try {
      mcpServers = overrideServers ?? await window.claude.mcp.list(projectId);
      if (!isCurrentEagerStart()) return;
      result = await window.claude.acp.start({
        agentId,
        cwd: getProjectCwd(project),
        mcpServers,
      });
    } catch (err) {
      if (!isCurrentEagerStart()) return;
      captureException(err instanceof Error ? err : new Error(String(err)), { label: "ACP_EAGER_START_ERR" });
      console.warn("[eagerStartAcpSession] start() failed:", err);
      toast.error(toastText("acp.initFailed"), {
        description: err instanceof Error ? err.message : String(err),
      });
      setAcpConfigOptionsLoading(false);
      return;
    }

    if (!isCurrentEagerStart()) {
      if ("sessionId" in result && result.sessionId) {
        suppressNextSessionCompletion(result.sessionId);
        void window.claude.acp.stop(result.sessionId);
      }
      return;
    }

    if ("cancelled" in result && result.cancelled) {
      setAcpConfigOptionsLoading(false);
      return;
    }

    if (!("sessionId" in result) || !result.sessionId) {
      const message = ("error" in result && result.error) ? result.error : toastText("acp.initFailed");
      console.warn("[eagerStartAcpSession] start() returned error:", message);
      toast.error(toastText("acp.initFailed"), { description: message });
      setAcpConfigOptionsLoading(false);
      return;
    }

    const sessionId = result.sessionId;
    const isStillDraft = isCurrentEagerStart()
      && isCurrentDraftTarget(projectId, "acp", agentId);

    if (!isStillDraft) {
      suppressNextSessionCompletion(sessionId);
      await window.claude.acp.stop(sessionId);
      setAcpConfigOptionsLoading(false);
      return;
    }

    draftAcpSessionIdRef.current = sessionId;
    setDraftAcpSessionId(sessionId);
    if ("authRequired" in result && result.authRequired) {
      acpAgentIdRef.current = agentId;
      acpAgentSessionIdRef.current = null;
      acp.setAuthMethods(result.authMethods ?? []);
      acp.setAuthRequired(true);
      setAcpConfigOptionsLoading(false);
      return;
    }
    acpAgentIdRef.current = agentId;
    acpAgentSessionIdRef.current = ("agentSessionId" in result && result.agentSessionId) ? result.agentSessionId : null;
    liveSessionIdsRef.current.add(sessionId);
    const commandPrewarm = prewarmSessionCommands(
      async () => (await window.claude.acp.getAvailableCommands(sessionId)).commands ?? [],
      normalizeAcpCommands,
    ).then((commands) => {
      if (
        !isCurrentEagerStart()
        || !isCurrentDraftTarget(projectId, "acp", agentId)
        || draftAcpSessionIdRef.current !== sessionId
      ) return;
      setInitialSlashCommands(commands);
    });
    commandPrewarmBySessionRef.current.set(sessionId, commandPrewarm);
    let resolvedConfigOptions = ("configOptions" in result && result.configOptions) ? result.configOptions : [];
    try {
      const bufferedConfig = await window.claude.acp.getConfigOptions(sessionId);
      if (
        !isCurrentEagerStart()
        || !isCurrentDraftTarget(projectId, "acp", agentId)
        || draftAcpSessionIdRef.current !== sessionId
      ) return;
      if ((bufferedConfig.configOptions?.length ?? 0) > 0) {
        resolvedConfigOptions = bufferedConfig.configOptions ?? [];
      }
    } catch {
      // Best-effort fetch only — use response payload if the buffer isn't ready yet.
    }
    acp.setConfigOptions(resolvedConfigOptions);
    setInitialConfigOptions(resolvedConfigOptions);

    await commandPrewarm;
    if (
      !isCurrentEagerStart()
      || !isCurrentDraftTarget(projectId, "acp", agentId)
      || draftAcpSessionIdRef.current !== sessionId
    ) return;

    if (
      isCurrentEagerStart()
      && isCurrentDraftTarget(projectId, "acp", agentId)
      && draftAcpSessionIdRef.current === sessionId
      && "mcpStatuses" in result
      && result.mcpStatuses?.length
    ) {
      setDraftMcpStatuses(result.mcpStatuses.map((status: { name: string; status: string }) => ({
        name: status.name,
        status: toMcpStatusState(status.status),
      })));
    }
    setAcpConfigOptionsLoading(false);
  }, [acp, findProject, getProjectCwd, isCurrentDraftTarget, setAcpConfigOptionsLoading, setDraftAcpSessionId, setDraftMcpStatuses, setInitialConfigOptions, setInitialSlashCommands]);

  // Load Codex models ahead of first message so the model picker is usable in draft mode.
  const prefetchCodexModels = useCallback(async (
    preferredModel?: string,
    isCurrent: () => boolean = () => true,
  ) => {
    setCodexModelsLoadingMessage("Checking Codex CLI...");
    try {
      const status = await window.claude.codex.binaryStatus();
      if (!isCurrent()) return false;
      if (!status.installed) {
        setCodexModelsLoadingMessage("Codex CLI not found. Downloading it now...");
      }

      const result = await window.claude.codex.listModels();
      if (!isCurrent()) return false;
      if (result.error) {
        setCodexModelsLoadingMessage(`Codex model load failed: ${result.error}`);
        return false;
      }
      const models = normalizeCodexModels(result.models ?? []);
      if (models.length === 0) {
        setCodexModelsLoadingMessage("No Codex models available yet.");
        return false;
      }

      setCodexRawModels(models);
      codex.setCodexModels(models.map((m) => ({
        value: m.id,
        displayName: m.displayName,
        description: m.description,
        supportsEffort: m.supportedReasoningEfforts.length > 0,
      })));

      const selected = pickCodexModel(preferredModel, models);
      const selectedModel = selected
        ? models.find((m) => m.id === selected)
        : undefined;
      applyCodexModelDefaultEffort(
        selectedModel && selectedModel.supportedReasoningEfforts.length > 0
          ? selectedModel.defaultReasoningEffort
          : undefined,
      );

      setStartOptions((prev) => {
        if ((prev.engine ?? "claude") !== "codex") return prev;
        const currentSelection = pickCodexModel(prev.model ?? preferredModel, models);
        if (!currentSelection || prev.model === currentSelection) return prev;
        return { ...prev, model: currentSelection };
      });
      setCodexModelsLoadingMessage(null);
      return true;
    } catch (err) {
      if (!isCurrent()) return false;
      // Model prefetch is optional — draft session can still start on first send.
      captureException(err instanceof Error ? err : new Error(String(err)), { label: "CODEX_MODELS_PREFETCH_ERR" });
      const message = err instanceof Error ? err.message : String(err);
      setCodexModelsLoadingMessage(`Failed to initialize Codex CLI: ${message}`);
      return false;
    }
  }, [applyCodexModelDefaultEffort, codex.setCodexModels, setCodexModelsLoadingMessage, setCodexRawModels, setStartOptions]);

  // Codex intentionally does not start a long-lived session for a draft on macOS.
  // Use its short-lived catalog endpoint instead so slash commands are available
  // without creating a Dock-visible CLI session.
  const prefetchCodexCommands = useCallback(async (
    cwd: string,
    isCurrent: () => boolean = () => true,
  ) => {
    let catalog = codexCommandCatalogByCwdRef.current.get(cwd);
    if (!catalog) {
      const initial = prewarmSessionCommands(
        async () => {
          const result = await window.claude.codex.listCommands(cwd);
          if (result.error) throw new Error(result.error);
          return result;
        },
        normalizeCodexCommands,
      );
      const apps = prewarmSessionCommands(
        async () => {
          const result = await window.claude.codex.listCommandApps(cwd);
          if (result.error) throw new Error(result.error);
          return result;
        },
        normalizeCodexCommands,
      );
      const complete = Promise.all([initial, apps]).then(([skillCommands, appCommands]) => {
        const commands = [...skillCommands, ...appCommands];
        if (commands.length === 0) {
          codexCommandCatalogByCwdRef.current.delete(cwd);
        }
        return commands;
      });
      catalog = { initial, complete };
      codexCommandCatalogByCwdRef.current.set(cwd, catalog);
    }
    const commands = await catalog.initial;
    if (!isCurrent()) return false;
    window.claude.codex.log("DRAFT_COMMANDS_PREWARMED", {
      cwd,
      count: commands.length,
    });
    setInitialSlashCommands(commands);
    void catalog.complete.then((completeCommands) => {
      if (!isCurrent()) return;
      window.claude.codex.log("DRAFT_COMMAND_APPS_PREWARMED", {
        cwd,
        count: completeCommands.length,
      });
      setInitialSlashCommands(completeCommands);
    });
    return true;
  }, [setInitialSlashCommands]);

  // Probe MCP servers ourselves (for engines that don't report status, e.g. ACP)
  const probeMcpServers = useCallback(async (
    projectId: string,
    overrideServers?: McpServerConfig[],
    draftOptions?: StartOptions,
  ) => {
    const isCurrentDraft = () => draftOptions?.engine
      ? isCurrentDraftTarget(projectId, draftOptions.engine, draftOptions.agentId)
      : activeSessionIdRef.current === DRAFT_ID && draftProjectIdRef.current === projectId;
    try {
      const servers = overrideServers ?? await window.claude.mcp.list(projectId);
      if (servers.length === 0) {
        if (isCurrentDraft()) setDraftMcpStatuses([]);
        return;
      }
      // Show pending while probing
      if (isCurrentDraft()) {
        setDraftMcpStatuses(servers.map(s => ({
          name: s.name,
          status: "pending" as const,
        })));
      }
      // Probe each server for real connectivity
      const results = await window.claude.mcp.probe(servers);
      if (isCurrentDraft()) {
        setDraftMcpStatuses(results.map(r => ({
          name: r.name,
          status: toMcpStatusState(r.status),
          ...(r.error ? { error: r.error } : {}),
        })));
      }
    } catch (err) {
      captureException(err instanceof Error ? err : new Error(String(err)), {
        label: "MCP_PROBE_ERR",
      });
    }
  }, [isCurrentDraftTarget]);

  // One dispatch point for draft prewarming. It is used both for a new chat
  // and for an engine/agent switch so their lifecycle and command behavior
  // cannot drift apart.
  const prewarmDraftSession = useCallback((projectId: string, options?: StartOptions) => {
    const engine = options?.engine ?? "claude";
    if (engine === "claude") {
      void eagerStartSession(projectId, options);
      void window.claude.mcp.list(projectId).then((servers) => {
        if (!isCurrentDraftTarget(projectId, "claude", options?.agentId)) return;
        setDraftMcpStatuses(servers.map((server) => ({
          name: server.name,
          status: "pending" as const,
        })));
      }).catch(() => { /* MCP status is best-effort during draft prewarm */ });
      return;
    }

    if (engine === "acp") {
      void eagerStartAcpSession(projectId, options);
      void probeMcpServers(projectId, undefined, options);
      return;
    }

    // Codex uses the short-lived catalog prefetch above instead of a session.
    setDraftMcpStatuses([]);
  }, [eagerStartAcpSession, eagerStartSession, isCurrentDraftTarget, probeMcpServers, setDraftMcpStatuses]);

  // Clean up a pre-started eager session
  const abandonEagerSession = useCallback((reason = "cleanup") => {
    ++draftGenerationRef.current;
    ++claudeEagerStartGenerationRef.current;
    const id = preStartedSessionIdRef.current;
    if (!id) return;
    suppressNextSessionCompletion(id);
    window.claude.stop(id, reason);
    liveSessionIdsRef.current.delete(id);
    backgroundStoreRef.current.delete(id);
    commandPrewarmBySessionRef.current.delete(id);
    preStartedSessionIdRef.current = null;
    setPreStartedSessionId(null);
    setDraftMcpStatuses([]);
  }, []);

  const abandonDraftAcpSession = useCallback((reason = "cleanup") => {
    void reason;
    ++acpEagerStartGenerationRef.current;
    const id = draftAcpSessionIdRef.current;
    if (id) {
      suppressNextSessionCompletion(id);
      void window.claude.acp.stop(id);
      liveSessionIdsRef.current.delete(id);
      backgroundStoreRef.current.delete(id);
      commandPrewarmBySessionRef.current.delete(id);
    }
    draftAcpSessionIdRef.current = null;
    setDraftAcpSessionId(null);
    pendingAcpDraftPromptRef.current = null;
    acp.clearAuthRequired();
    setAcpConfigOptionsLoading(false);
    setInitialConfigOptions([]);
    setInitialSlashCommands([]);
    setDraftMcpStatuses([]);
  }, [setAcpConfigOptionsLoading, setDraftAcpSessionId, setDraftMcpStatuses, setInitialConfigOptions, setInitialSlashCommands]);

  const materializeDraft = useCallback(
    async (
      text: string,
      images?: ImageAttachment[],
      displayText?: string,
    ): Promise<MaterializedDraftSession | null> => {
      const materializationGeneration = draftGenerationRef.current;
      // Prevent duplicate sends for the same draft, while allowing a newer
      // draft to proceed before an abandoned async start has settled.
      if (
        materializingRef.current
        && materializingGenerationRef.current === materializationGeneration
      ) {
        return null;
      }
      materializingRef.current = true;
      materializingGenerationRef.current = materializationGeneration;

      const projectId = draftProjectIdRef.current;
      const releaseMaterialization = () => {
        if (materializingGenerationRef.current !== materializationGeneration) return;
        materializingGenerationRef.current = null;
        materializingRef.current = false;
      };
      const isCurrentMaterialization = () => (
        materializingGenerationRef.current === materializationGeneration
        && draftGenerationRef.current === materializationGeneration
        && activeSessionIdRef.current === DRAFT_ID
        && draftProjectIdRef.current === projectId
      );
      const discardMaterializedSession = (engine: EngineId, sessionId: string) => {
        suppressNextSessionCompletion(sessionId);
        if (engine === "acp") {
          void window.claude.acp.stop(sessionId);
        } else if (engine === "codex") {
          void window.claude.codex.stop(sessionId);
        } else {
          void window.claude.stop(sessionId, "draft_abandoned");
        }
        liveSessionIdsRef.current.delete(sessionId);
        backgroundStoreRef.current.delete(sessionId);
      };

      const project = projectId ? findProject(projectId) : null;
      if (!project) {
        console.warn("[materializeDraft] No project found for draftProjectId:", projectId);
        releaseMaterialization();
        return null;
      }
      const options = startOptionsRef.current;
      const draftEngine = options.engine ?? "claude";
      let sessionId: string;
      let sessionModel = options.model;
      let codexThreadId: string | undefined;
      let codexRolloutPath: string | undefined;
      let restoredMessages: UIMessage[] = [];
      let restoredMeta: import("./types").InitialMeta | null = null;
      let restoredPermission: import("@/types").PermissionRequest | null = null;
      let restoredRawAcpPermission: import("@/types").ACPPermissionEvent | null = null;
      let restoredSlashCommands: import("@/types").SlashCommand[] = [];

      // Load per-project MCP servers to pass to the session
      let mcpServers: McpServerConfig[];
      try {
        mcpServers = await window.claude.mcp.list(project.id);
      } catch (err) {
        captureException(err instanceof Error ? err : new Error(String(err)), {
          label: "MATERIALIZE_MCP_LIST_ERR",
        });
        releaseMaterialization();
        return null;
      }
      if (!isCurrentMaterialization()) {
        releaseMaterialization();
        return null;
      }
      const draftCwd = options.cwd ?? getProjectCwd(project);

      if (draftEngine === "acp" && options.agentId) {
        // Show a "New Chat" entry in the sidebar immediately — before the blocking acp:start.
        // Uses DRAFT_ID as a placeholder; replaced with real session ID on success, removed on error.
        setSessions(prev => [{
          id: DRAFT_ID,
          projectId: project.id,
          title: "New Chat",
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
          totalCost: 0,
          requestLog: [],
          effort: options.effort,
          permissionMode: options.permissionMode,
          planMode: !!options.planMode,
          isActive: true,
          engine: "acp" as const,
          agentId: options.agentId,
        }, ...prev.map(s => ({ ...s, isActive: false }))]);
        const eagerSessionId = draftAcpSessionIdRef.current;
        if (eagerSessionId && liveSessionIdsRef.current.has(eagerSessionId) && !acp.authRequired) {
          const commandPrewarm = commandPrewarmBySessionRef.current.get(eagerSessionId);
          if (commandPrewarm) {
            await commandPrewarm;
            commandPrewarmBySessionRef.current.delete(eagerSessionId);
            if (!isCurrentMaterialization()) {
              releaseMaterialization();
              return null;
            }
          }
          sessionId = eagerSessionId;
          draftAcpSessionIdRef.current = null;
          setDraftAcpSessionId(null);
        } else {
          let result;
          try {
            result = await window.claude.acp.start({
              agentId: options.agentId,
              cwd: draftCwd,
              mcpServers,
            });
          } catch (err) {
            captureException(err instanceof Error ? err : new Error(String(err)), {
              label: "MATERIALIZE_ACP_START_ERR",
            });
            if (isCurrentMaterialization()) {
              setSessions(prev => prev.filter(s => s.id !== DRAFT_ID));
            }
            releaseMaterialization();
            return null;
          }
          if (!isCurrentMaterialization()) {
            if ("sessionId" in result && result.sessionId) {
              discardMaterializedSession("acp", result.sessionId);
            }
            releaseMaterialization();
            return null;
          }
          if ("cancelled" in result && result.cancelled) {
            setSessions(prev => prev.filter(s => s.id !== DRAFT_ID));
            releaseMaterialization();
            return null;
          }
          if (!("sessionId" in result) || !result.sessionId) {
            const errorMsg = ("error" in result && result.error) ? result.error : "Failed to start agent session";
            const failedId = `failed-acp-${Date.now()}`;
            const errorMessages: UIMessage[] = [
              createUserMessage(text, images, displayText),
              createSystemMessage(errorMsg, true),
            ];

            setSessions(prev => prev.map(s =>
              s.id === DRAFT_ID ? { ...s, id: failedId, titleGenerating: false } : s,
            ));
            setInitialMessages(errorMessages);
            setInitialMeta({
              isProcessing: false,
              isConnected: false,
              sessionInfo: null,
              totalCost: 0,
              requestLog: [],
              contextUsage: null,
            });
            setActiveSessionId(failedId);
            setDraftProjectId(null);

            window.claude.sessions.save({
              id: failedId,
              projectId: project.id,
              title: "New Chat",
              createdAt: Date.now(),
              messages: errorMessages,
              effort: options.effort,
              permissionMode: options.permissionMode,
              planMode: !!options.planMode,
              totalCost: 0,
              requestLog: [],
              engine: "acp",
              agentId: options.agentId,
            });

            releaseMaterialization();
            return null;
          }
          if ("authRequired" in result && result.authRequired) {
            acpAgentIdRef.current = options.agentId;
            acpAgentSessionIdRef.current = null;
            draftAcpSessionIdRef.current = result.sessionId;
            setDraftAcpSessionId(result.sessionId);
            setInitialMessages([createUserMessage(text, images, displayText)]);
            setInitialMeta({
              isProcessing: false,
              isConnected: false,
              sessionInfo: null,
              totalCost: 0,
              requestLog: [],
              contextUsage: null,
            });
            acp.setAuthMethods(result.authMethods ?? []);
            acp.setAuthRequired(true);
            setAcpConfigOptionsLoading(false);
            releaseMaterialization();
            return null;
          }
          sessionId = result.sessionId;
          acpAgentIdRef.current = options.agentId;
          acpAgentSessionIdRef.current = ("agentSessionId" in result && result.agentSessionId) ? result.agentSessionId : null;
          if ("configOptions" in result && result.configOptions?.length) {
            setInitialConfigOptions(result.configOptions);
          }
        }
        // Transition draftMcpStatuses (from probe) → acpMcpStatuses for the live session
        setAcpMcpStatuses(draftMcpStatusesRef.current.length > 0
          ? draftMcpStatusesRef.current
          : mcpServers.map(s => ({ name: s.name, status: "connected" as const }))
        );
      } else if (draftEngine === "codex") {
        // Codex app-server path
        await prefetchCodexCommands(draftCwd, isCurrentMaterialization);
        if (!isCurrentMaterialization()) {
          releaseMaterialization();
          return null;
        }
        setSessions(prev => [{
          id: DRAFT_ID,
          projectId: project.id,
          title: "New Chat",
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
          totalCost: 0,
          requestLog: [],
          effort: options.effort,
          permissionMode: options.permissionMode,
          planMode: !!options.planMode,
          isActive: true,
          engine: "codex" as const,
          agentId: options.agentId ?? "codex",
        }, ...prev.map(s => ({ ...s, isActive: false }))]);

        const draftModel = pickCodexModel(options.model, codexRawModelsRef.current);
        const approvalPolicy = getCodexApprovalPolicy(options);
        const sandbox = getCodexSandboxMode(options);
        let result;
        try {
          result = await window.claude.codex.start({
            cwd: draftCwd,
            ...(draftModel ? { model: draftModel } : {}),
            ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
            ...(approvalPolicy ? { approvalPolicy } : {}),
            ...(sandbox ? { sandbox } : {}),
          });
        } catch (err) {
          captureException(err instanceof Error ? err : new Error(String(err)), {
            label: "MATERIALIZE_CODEX_START_ERR",
          });
          if (isCurrentMaterialization()) {
            setSessions(prev => prev.filter(s => s.id !== DRAFT_ID));
          }
          releaseMaterialization();
          return null;
        }
        if (!isCurrentMaterialization()) {
          if (result.sessionId) {
            discardMaterializedSession("codex", result.sessionId);
          }
          releaseMaterialization();
          return null;
        }

        if (result.error || !result.sessionId) {
          const errorMsg = result.error || "Failed to start Codex session";
          const failedId = `failed-codex-${Date.now()}`;
          const errorMessages: UIMessage[] = [
            createUserMessage(text, images, displayText),
            createSystemMessage(errorMsg, true),
          ];
          setSessions(prev => prev.map(s => s.id === DRAFT_ID ? { ...s, id: failedId, titleGenerating: false } : s));
          setInitialMessages(errorMessages);
          setInitialMeta({
            isProcessing: false,
            isConnected: false,
            sessionInfo: null,
            totalCost: 0,
            requestLog: [],
            contextUsage: null,
          });
          setActiveSessionId(failedId);
          setDraftProjectId(null);
          window.claude.sessions.save({
            id: failedId,
            projectId: project.id,
            title: "New Chat",
            createdAt: Date.now(),
            messages: errorMessages,
            effort: options.effort,
            permissionMode: options.permissionMode,
            planMode: !!options.planMode,
            totalCost: 0,
            requestLog: [],
            engine: "codex",
          });
          releaseMaterialization();
          return null;
        }

        sessionId = result.sessionId;
        codexThreadId = result.threadId;
        codexRolloutPath = result.rolloutPath;
        let resolvedCodexModel = result.selectedModel;

        // Store Codex models for the model picker (map from Codex Model → our ModelInfo)
        if (result.models && Array.isArray(result.models)) {
          const models = normalizeCodexModels(result.models);
          if (models.length > 0) {
            codex.setCodexModels(models.map((m) => ({
              value: m.id,
              displayName: m.displayName,
              description: m.description,
              supportsEffort: m.supportedReasoningEfforts.length > 0,
            })));
            setCodexRawModels(models);
            const selectedId = pickCodexModel(result.selectedModel ?? options.model, models);
            const selectedModel = selectedId
              ? models.find((m) => m.id === selectedId)
              : undefined;
            resolvedCodexModel = selectedId ?? resolvedCodexModel;
            applyCodexModelDefaultEffort(
              selectedModel && selectedModel.supportedReasoningEfforts.length > 0
                ? selectedModel.defaultReasoningEffort
                : undefined,
            );
          }
        }
        if (!resolvedCodexModel) {
          resolvedCodexModel = draftModel;
        }
        sessionModel = resolvedCodexModel ?? sessionModel;

        // If auth is required, show auth dialog (handled by UI layer via codex:auth_required event)
        if (result.needsAuth) {
          // Session is alive but waiting for auth — UI will render CodexAuthDialog
        }
      } else {
        // Claude SDK path — reuse pre-started session if available
        const preStarted = preStartedSessionIdRef.current;
        if (preStarted && liveSessionIdsRef.current.has(preStarted)) {
          const commandPrewarm = commandPrewarmBySessionRef.current.get(preStarted);
          if (commandPrewarm) {
            await commandPrewarm;
            commandPrewarmBySessionRef.current.delete(preStarted);
            if (!isCurrentMaterialization()) {
              releaseMaterialization();
              return null;
            }
          }
          sessionId = preStarted;
          preStartedSessionIdRef.current = null;
          setPreStartedSessionId(null);
          // Consume background store state accumulated during draft
          const bgState = backgroundStoreRef.current.consume(sessionId);
          if (bgState) {
            restoredMessages = bgState.messages;
            restoredMeta = {
              isProcessing: bgState.isProcessing,
              isConnected: bgState.isConnected,
              sessionInfo: bgState.sessionInfo,
              totalCost: bgState.totalCost,
              upstreamRequestCount: bgState.upstreamRequestCount,
              requestLog: bgState.requestLog ?? [],
              contextUsage: bgState.contextUsage,
              isCompacting: bgState.isCompacting,
            };
            restoredPermission = bgState.pendingPermission;
            restoredRawAcpPermission = bgState.rawAcpPermission;
            restoredSlashCommands = bgState.slashCommands ?? [];
          }
        } else {
          // Fallback: start normally (eager start failed or was cleaned up)
          let result;
          try {
            result = await window.claude.start({
              cwd: draftCwd,
              model: options.model,
              permissionMode: getEffectiveClaudePermissionMode(options),
              thinkingEnabled: options.thinkingEnabled,
              effort: options.effort,
              claudeCodexBridgeEnabled: options.claudeCodexBridgeEnabled,
              mcpServers,
            });
          } catch (err) {
            captureException(err instanceof Error ? err : new Error(String(err)), { label: "MATERIALIZE_START_ERR" });
            console.error("[materializeDraft] start() failed:", err);
            releaseMaterialization();
            return null;
          }
          if (!isCurrentMaterialization()) {
            if (!result.error && result.sessionId) {
              discardMaterializedSession("claude", result.sessionId);
            }
            releaseMaterialization();
            return null;
          }
          if (result.error) {
            // The exit event handler in useClaude will show the error message
            console.error("[materializeDraft] start() returned error:", result.error);
            releaseMaterialization();
            return null;
          }
          sessionId = result.sessionId;
        }
      }
      if (!isCurrentMaterialization()) {
        discardMaterializedSession(draftEngine, sessionId);
        releaseMaterialization();
        return null;
      }
      liveSessionIdsRef.current.add(sessionId);

      const now = Date.now();
      const currentBranch = refs.currentBranchRef.current;
      const newSession: ChatSession = {
        id: sessionId,
        projectId: project.id,
        title: "New Chat",
        createdAt: now,
        lastMessageAt: now,
        model: sessionModel,
        effort: options.effort,
        permissionMode: options.permissionMode,
        planMode: !!options.planMode,
        totalCost: 0,
        requestLog: [],
        isActive: true,
        titleGenerating: true,
        ...(currentBranch ? { branch: currentBranch } : {}),
        engine: draftEngine,
        ...(draftEngine === "acp" && options.agentId ? {
          agentId: options.agentId,
          agentSessionId: acpAgentSessionIdRef.current ?? undefined,
        } : {}),
        ...(draftEngine === "codex" ? {
          agentId: options.agentId ?? "codex",
          codexThreadId,
          codexRolloutPath,
        } : {}),
      };

      // Replace the DRAFT_ID placeholder (if any) with the real session entry
      setSessions((prev) =>
        [newSession, ...prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false }))],
      );
      // Seed the accepted user turn before exposing the live ID. If the user
      // switches immediately, switchSession can transfer this exact state into
      // the background store and the explicit-ID send may finish there.
      setInitialMessages([
        ...restoredMessages,
        createUserMessage(text, images, displayText),
      ]);
      setInitialMeta({
        ...(restoredMeta ?? {
          sessionInfo: null,
          totalCost: 0,
          requestLog: [],
          contextUsage: null,
        }),
        isProcessing: true,
        isConnected: true,
      });
      setInitialPermission(restoredPermission);
      setInitialRawAcpPermission(restoredRawAcpPermission);
      if (draftEngine === "claude") {
        setInitialSlashCommands(restoredSlashCommands);
      }
      setActiveSessionId(sessionId);
      if (draftEngine === "acp") {
        acp.clearAuthRequired();
        setDraftAcpSessionId(null);
      }
      setDraftProjectId(null);

      // Refresh MCP status since useClaude may have missed the system init event
      setTimeout(() => { claude.refreshMcpStatus(); }, 500);

      // Fire-and-forget AI title generation — routes through ACP if that's the active engine
      generateSessionTitle(sessionId, text, draftCwd, draftEngine);

      releaseMaterialization();
      return {
        sessionId,
        engine: draftEngine,
        model: sessionModel,
        planMode: !!options.planMode,
      };
    },
    [acp, applyCodexModelDefaultEffort, findProject, generateSessionTitle, codex.setCodexModels, prefetchCodexCommands, setDraftAcpSessionId],
  );

  return {
    eagerStartSession,
    eagerStartAcpSession,
    prefetchCodexModels,
    prefetchCodexCommands,
    probeMcpServers,
    prewarmDraftSession,
    abandonEagerSession,
    abandonDraftAcpSession,
    materializeDraft,
  };
}
