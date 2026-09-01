import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  useRef: <T,>(value: T) => ({ current: value }),
}));

describe("useSessionRevival", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      claude: {
        mcp: { list: vi.fn(async () => []) },
        sessions: {
          load: vi.fn(),
          save: vi.fn(),
          delete: vi.fn(),
        },
        acp: {
          reviveSession: vi.fn(),
          attachRenderer: vi.fn(),
          stop: vi.fn(async () => ({ ok: true })),
          prompt: vi.fn(async () => ({
            ok: true,
            status: "completed",
            outcomeDelivered: true,
            turnId: "turn-1",
          })),
        },
      },
    });
  });

  it("publishes a revived runtime before useACP attaches instead of attaching eagerly", async () => {
    const configOptions = [{
      id: "model",
      name: "Model",
      type: "select" as const,
      currentValue: "provider/model",
      options: [{ value: "provider/model", name: "Model" }],
    }];
    vi.mocked(window.claude.acp.reviveSession).mockResolvedValue({
      sessionId: "persisted-session",
      agentSessionId: "pi-session",
      usedLoad: true,
      configOptions,
      mcpStatuses: [],
    });

    const activeSessionIdRef = { current: "persisted-session" };
    const liveSessionIdsRef = { current: new Set<string>() };
    const setters = {
      setSessions: vi.fn(),
      setActiveSessionId: vi.fn(),
      setInitialMessages: vi.fn(),
      setInitialMeta: vi.fn(),
      setInitialConfigOptions: vi.fn(),
      setAcpConfigOptionsLoading: vi.fn(),
      setAcpMcpStatuses: vi.fn(),
    };
    const acp = {
      setMessages: vi.fn(),
      setIsProcessing: vi.fn(),
      setConfigOptions: vi.fn(),
      hydrate: vi.fn(),
    };
    const { useSessionRevival } = await import("../useSessionRevival");
    const { reviveAcpSession } = useSessionRevival({
      refs: {
        activeSessionIdRef,
        sessionsRef: {
          current: [{
            id: "persisted-session",
            projectId: "project-1",
            title: "Old Pi session",
            createdAt: 1,
            isActive: true,
            engine: "acp",
            agentId: "pi-acp",
            agentSessionId: "pi-session",
          }],
        },
        messagesRef: { current: [] },
        totalCostRef: { current: 0 },
        upstreamRequestCountRef: { current: 0 },
        requestLogRef: { current: [] },
        contextUsageRef: { current: null },
        liveSessionIdsRef,
        acpAgentIdRef: { current: null },
        acpAgentSessionIdRef: { current: null },
        acpConfigOptionsRef: { current: configOptions },
      },
      setters,
      engines: { acp },
      findProject: () => ({
        id: "project-1",
        name: "Project",
        path: "/tmp/project",
        createdAt: 1,
      }),
      getProjectCwd: () => "/tmp/project",
    } as never);

    await reviveAcpSession("continue");

    expect(window.claude.acp.reviveSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "persisted-session",
      agentSessionId: "pi-session",
      initialConfigOptions: configOptions,
    }));
    expect(window.claude.acp.attachRenderer).not.toHaveBeenCalled();
    expect(liveSessionIdsRef.current.has("persisted-session")).toBe(true);
    expect(setters.setInitialConfigOptions).toHaveBeenCalledWith(configOptions);
    expect(setters.setAcpConfigOptionsLoading).toHaveBeenNthCalledWith(1, true);
    expect(setters.setAcpConfigOptionsLoading).toHaveBeenLastCalledWith(false);
    expect(acp.setConfigOptions).toHaveBeenCalledWith(configOptions);
    expect(acp.hydrate).toHaveBeenCalled();
    expect(window.claude.acp.prompt).toHaveBeenCalledWith(
      "persisted-session",
      "continue",
      undefined,
    );
  });
});
