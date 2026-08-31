import { describe, expect, it, vi } from "vitest";
import type { ACPConfigOption, ChatSession, SlashCommand } from "@/types";
import { applySelectedSessionReadState, useSessionCrud } from "../useSessionCrud";

vi.mock("react", () => ({
  startTransition: (fn: () => void) => fn(),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useRef: <T,>(value: T) => ({ current: value }),
}));

describe("applySelectedSessionReadState", () => {
  it("clears unread completion when a completed background session is selected", () => {
    const session: ChatSession = {
      id: "session-1",
      projectId: "project-1",
      title: "Background reply",
      createdAt: 1,
      totalCost: 0,
      isActive: false,
      hasUnreadCompletion: true,
      hasPendingPermission: true,
    };

    expect(applySelectedSessionReadState(session, "session-1")).toMatchObject({
      id: "session-1",
      isActive: true,
      hasUnreadCompletion: false,
      hasPendingPermission: false,
    });
  });

  it("keeps other sessions inactive without changing their unread state", () => {
    const session: ChatSession = {
      id: "session-2",
      projectId: "project-1",
      title: "Still unread",
      createdAt: 1,
      totalCost: 0,
      isActive: true,
      hasUnreadCompletion: true,
    };

    expect(applySelectedSessionReadState(session, "session-1")).toMatchObject({
      id: "session-2",
      isActive: false,
      hasUnreadCompletion: true,
    });
  });
});

describe("useSessionCrud draft initialization", () => {
  it("rehydrates registry caches for every consecutive draft without starting ACP", async () => {
    const start = vi.fn();
    vi.stubGlobal("window", { claude: { acp: { start } } });
    const cachedConfigOptions: ACPConfigOption[] = [{
      id: "model",
      name: "Model",
      type: "select",
      currentValue: "provider/model",
      options: [{ value: "provider/model", name: "Model" }],
    }];
    const cachedSlashCommands: SlashCommand[] = [{
      name: "compact",
      description: "Compact context",
      source: "acp",
    }];
    const setInitialConfigOptions = vi.fn();
    const setInitialSlashCommands = vi.fn();
    const abandonDraftAcpSession = vi.fn();
    const startOptionsRef = { current: {} };
    const draftProjectIdRef = { current: null };
    const activeSessionIdRef = { current: null };

    const crud = useSessionCrud({
      refs: {
        activeSessionIdRef,
        sessionsRef: { current: [] },
        installedAgentsRef: { current: [{
          id: "pi-acp",
          name: "Pi",
          engine: "acp",
          cachedConfigOptions,
          cachedSlashCommands,
        }] },
        liveSessionIdsRef: { current: new Set() },
        backgroundStoreRef: { current: new Map() },
        draftProjectIdRef,
        startOptionsRef,
        acpAgentIdRef: { current: null },
        acpAgentSessionIdRef: { current: null },
        messageQueueRef: { current: new Map() },
        switchSessionRef: { current: null },
        onSpaceChangeRef: { current: undefined },
        draftGenerationRef: { current: 0 },
        saveTimerRef: { current: null },
      },
      setters: {
        setSessions: vi.fn(),
        setActiveSessionId: vi.fn(),
        setInitialMessages: vi.fn(),
        setInitialMeta: vi.fn(),
        setInitialConfigOptions,
        setInitialSlashCommands,
        setInitialPermission: vi.fn(),
        setInitialRawAcpPermission: vi.fn(),
        setStartOptions: vi.fn(),
        setDraftProjectId: vi.fn(),
        setDraftAcpSessionId: vi.fn(),
        setAcpConfigOptionsLoading: vi.fn(),
        setDraftMcpStatuses: vi.fn(),
        setAcpMcpStatuses: vi.fn(),
        setQueuedCount: vi.fn(),
      },
      engines: {
        acp: {
          setMessages: vi.fn(),
          setIsProcessing: vi.fn(),
        },
      },
      findProject: vi.fn(),
      getProjectCwd: vi.fn(),
      saveCurrentSession: vi.fn(async () => undefined),
      seedBackgroundStore: vi.fn(),
      abandonDraftAcpSession,
      cacheSessionPayload: vi.fn(),
      consumeCachedSessionPayload: vi.fn(() => null),
      applyLoadedSession: vi.fn(),
      evictFromCache: vi.fn(),
      clearQueue: vi.fn(),
    } as never);

    await crud.createSession("project-1", { engine: "acp", agentId: "pi-acp" });
    await crud.createSession("project-1", { engine: "acp", agentId: "pi-acp" });

    expect(setInitialConfigOptions).toHaveBeenNthCalledWith(1, cachedConfigOptions);
    expect(setInitialConfigOptions).toHaveBeenNthCalledWith(2, cachedConfigOptions);
    expect(setInitialSlashCommands).toHaveBeenNthCalledWith(1, cachedSlashCommands);
    expect(setInitialSlashCommands).toHaveBeenNthCalledWith(2, cachedSlashCommands);
    expect(abandonDraftAcpSession).toHaveBeenCalledTimes(2);
    expect(abandonDraftAcpSession).toHaveBeenCalledWith("new_draft");
    expect(startOptionsRef.current).toMatchObject({
      engine: "acp",
      agentId: "pi-acp",
      cachedConfigOptions,
      cachedSlashCommands,
    });
    expect(draftProjectIdRef.current).toBe("project-1");
    expect(activeSessionIdRef.current).toBe("__draft__");
    expect(start).not.toHaveBeenCalled();
  });
});
