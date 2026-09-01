import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ACPConfigOption } from "@/types";
import { DRAFT_ID, type StartOptions } from "../types";

vi.mock("react", () => ({
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useRef: <T>(value: T) => ({ current: value }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function setter() {
  return vi.fn((value: unknown) => value);
}

function makeParams() {
  return {
    refs: {
      activeSessionIdRef: { current: DRAFT_ID },
      draftProjectIdRef: { current: "project-1" },
      projectsRef: { current: [{ id: "project-1", path: "/tmp/project" }] },
      startOptionsRef: { current: { engine: "acp", agentId: "pi-acp" } as StartOptions },
      liveSessionIdsRef: { current: new Set<string>() },
      backgroundStoreRef: { current: new Map() },
      draftAcpSessionIdRef: { current: null as string | null },
      draftMcpStatusesRef: { current: [] },
      materializingRef: { current: false },
      pendingAcpDraftPromptRef: { current: null },
      acpAgentIdRef: { current: null },
      acpAgentSessionIdRef: { current: null },
      acpConfigOptionsRef: { current: [] as ACPConfigOption[] },
      codexRawModelsRef: { current: [] },
      draftGenerationRef: { current: 0 },
      claudeModelCatalogRequestGenerationRef: { current: 0 },
      claudeEagerStartGenerationRef: { current: 0 },
      currentBranchRef: { current: undefined },
    },
    setters: {
      setDraftAcpSessionId: setter(),
      setDraftMcpStatuses: setter(),
      setAcpMcpStatuses: setter(),
      setInitialConfigOptions: setter(),
      setInitialSlashCommands: setter(),
      setAcpConfigOptionsLoading: setter(),
      setCachedModels: setter(),
      setSessions: setter(),
      setActiveSessionId: setter(),
      setInitialMessages: setter(),
      setInitialMeta: setter(),
      setInitialPermission: setter(),
      setInitialRawAcpPermission: setter(),
      setStartOptions: setter(),
      setDraftProjectId: setter(),
    },
    engines: {
      acp: {
        setMessages: vi.fn(),
        setConfigOptions: vi.fn(),
        setAuthMethods: vi.fn(),
        setAuthRequired: vi.fn(),
        clearAuthRequired: vi.fn(),
      },
    },
    findProject: vi.fn(() => ({ id: "project-1", path: "/tmp/project" } as never)),
    getProjectCwd: vi.fn(() => "/tmp/project"),
    generateSessionTitle: vi.fn(),
    applyCodexModelDefaultEffort: vi.fn(),
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useDraftMaterialization", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      claude: {
        mcp: { list: vi.fn(async () => []) },
        acp: {
          start: vi.fn(),
          stop: vi.fn(),
          abortPendingStart: vi.fn(async () => ({ ok: true })),
          getConfigOptions: vi.fn(async () => ({ configOptions: [] })),
          getAvailableCommands: vi.fn(async () => ({ commands: [] })),
        },
      },
    });
  });

  it("does not start ACP while preparing draft MCP status", async () => {
    const { useDraftMaterialization } = await import("../useDraftMaterialization");
    const params = makeParams();

    const materialization = useDraftMaterialization(
      params as unknown as Parameters<typeof useDraftMaterialization>[0],
    );
    await materialization.probeMcpServers("project-1", [], {
      engine: "acp",
      agentId: "pi-acp",
    });

    expect(window.claude.acp.start).not.toHaveBeenCalled();
  });

  it("starts ACP on first materialization and forwards cached selector values", async () => {
    const { useDraftMaterialization } = await import("../useDraftMaterialization");
    const params = makeParams();
    const cachedConfigOptions = [{
      id: "model",
      name: "Model",
      category: "model",
      type: "select" as const,
      currentValue: "cached-model",
      options: [{ value: "cached-model", name: "Cached Model" }],
    }];
    params.refs.acpConfigOptionsRef.current = cachedConfigOptions;
    vi.mocked(window.claude.acp.start).mockResolvedValue({
      sessionId: "pi-session",
      agentSessionId: "pi-agent-session",
      configOptions: cachedConfigOptions,
    });

    const materialization = useDraftMaterialization(
      params as unknown as Parameters<typeof useDraftMaterialization>[0],
    );
    await expect(materialization.materializeDraft("hello")).resolves.toMatchObject({
      sessionId: "pi-session",
    });

    expect(window.claude.acp.start).toHaveBeenCalledWith({
      agentId: "pi-acp",
      cwd: "/tmp/project",
      mcpServers: [],
      initialConfigOptions: cachedConfigOptions,
    });
    expect(params.refs.liveSessionIdsRef.current).toContain("pi-session");
    expect(params.setters.setAcpConfigOptionsLoading).toHaveBeenCalledWith(true);
    expect(params.setters.setAcpConfigOptionsLoading).toHaveBeenLastCalledWith(false);
  });

  it("replaces an empty fresh-profile cache with live Pi options", async () => {
    const { useDraftMaterialization } = await import("../useDraftMaterialization");
    const params = makeParams();
    const start = deferred<{
      sessionId: string;
      agentSessionId: string;
      configOptions: ACPConfigOption[];
    }>();
    const liveConfigOptions: ACPConfigOption[] = [{
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "fixture/model",
      options: [{ value: "fixture/model", name: "Fixture Model" }],
    }];
    vi.mocked(window.claude.acp.start).mockReturnValue(start.promise);

    const materialization = useDraftMaterialization(
      params as unknown as Parameters<typeof useDraftMaterialization>[0],
    );
    const pending = materialization.materializeDraft("hello");
    await flushAsync();

    expect(params.setters.setAcpConfigOptionsLoading).toHaveBeenLastCalledWith(true);
    start.resolve({
      sessionId: "pi-session",
      agentSessionId: "pi-agent-session",
      configOptions: liveConfigOptions,
    });

    await expect(pending).resolves.toMatchObject({ sessionId: "pi-session" });
    expect(params.setters.setInitialConfigOptions).toHaveBeenCalledWith(liveConfigOptions);
    expect(params.engines.acp.setConfigOptions).toHaveBeenCalledWith(liveConfigOptions);
    expect(params.setters.setAcpConfigOptionsLoading).toHaveBeenLastCalledWith(false);
  });

  it("surfaces a user cancellation and clears startup loading", async () => {
    const { useDraftMaterialization } = await import("../useDraftMaterialization");
    const params = makeParams();
    vi.mocked(window.claude.acp.start).mockResolvedValue({
      cancelled: true,
      cancelReason: "user_stop",
    });

    const materialization = useDraftMaterialization(
      params as unknown as Parameters<typeof useDraftMaterialization>[0],
    );
    await expect(materialization.materializeDraft("hello")).resolves.toBeNull();

    const updateMessages = params.engines.acp.setMessages.mock.calls.at(-1)?.[0];
    expect(typeof updateMessages).toBe("function");
    expect(updateMessages([])).toEqual([
      expect.objectContaining({
        role: "system",
        content: "Pi startup was cancelled by you.",
      }),
    ]);
    expect(params.setters.setAcpConfigOptionsLoading).toHaveBeenLastCalledWith(false);
  });

  it("releases the materialization guard when MCP loading rejects", async () => {
    const { useDraftMaterialization } = await import("../useDraftMaterialization");
    const params = makeParams();
    params.findProject.mockReturnValue(params.refs.projectsRef.current[0] as never);
    vi.mocked(window.claude.mcp.list).mockRejectedValue(new Error("MCP unavailable"));

    const materialization = useDraftMaterialization(
      params as unknown as Parameters<typeof useDraftMaterialization>[0],
    );

    await expect(materialization.materializeDraft("first")).resolves.toBeNull();
    await expect(materialization.materializeDraft("retry")).resolves.toBeNull();

    expect(window.claude.mcp.list).toHaveBeenCalledTimes(2);
    expect(params.refs.materializingRef.current).toBe(false);
  });

  it("discards a session that starts after its draft is abandoned", async () => {
    const { useDraftMaterialization } = await import("../useDraftMaterialization");
    const params = makeParams();
    params.findProject.mockReturnValue(params.refs.projectsRef.current[0] as never);
    const start = deferred<{ sessionId: string }>();
    vi.mocked(window.claude.acp.start).mockReturnValue(start.promise);

    const materialization = useDraftMaterialization(
      params as unknown as Parameters<typeof useDraftMaterialization>[0],
    );
    const pending = materialization.materializeDraft("hello");
    await flushAsync();

    materialization.abandonDraftAcpSession("switch_session");
    start.resolve({ sessionId: "stale-session" });

    await expect(pending).resolves.toBeNull();
    expect(window.claude.acp.stop).toHaveBeenCalledWith("stale-session");
    expect(window.claude.acp.abortPendingStart).toHaveBeenCalledWith("switch_session");
    expect(params.refs.liveSessionIdsRef.current).not.toContain("stale-session");
    expect(params.refs.materializingRef.current).toBe(false);
  });
});
