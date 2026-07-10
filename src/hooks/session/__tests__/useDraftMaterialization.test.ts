import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_ID } from "../types";

vi.mock("react", () => ({
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
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
      startOptionsRef: { current: { engine: "claude" as const } },
      liveSessionIdsRef: { current: new Set<string>() },
      backgroundStoreRef: { current: new Map() },
      preStartedSessionIdRef: { current: null as string | null },
      draftAcpSessionIdRef: { current: null as string | null },
      draftMcpStatusesRef: { current: [] },
      materializingRef: { current: false },
      pendingAcpDraftPromptRef: { current: null },
      acpAgentIdRef: { current: null },
      acpAgentSessionIdRef: { current: null },
      codexRawModelsRef: { current: [] },
      claudeModelCatalogRequestGenerationRef: { current: 0 },
      claudeEagerStartGenerationRef: { current: 0 },
    },
    setters: {
      setPreStartedSessionId: setter(),
      setDraftMcpStatuses: setter(),
      setCachedModels: setter(),
    },
    engines: {
      claude: {},
      acp: {},
      codex: {},
    },
    findProject: vi.fn(),
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
        start: vi.fn(),
        stop: vi.fn(),
        mcpStatus: vi.fn(async () => ({ servers: [] })),
        supportedModels: vi.fn(async () => ({ models: [] })),
      },
    });
  });

  it("keeps only the newest same-project eager start when starts resolve in reverse order", async () => {
    const { useDraftMaterialization } = await import("../useDraftMaterialization");
    const params = makeParams();
    const firstStart = deferred<{ sessionId: string; pid: number }>();
    const secondStart = deferred<{ sessionId: string; pid: number }>();
    vi.mocked(window.claude.start)
      .mockReturnValueOnce(firstStart.promise)
      .mockReturnValueOnce(secondStart.promise);

    const materialization = useDraftMaterialization(
      params as unknown as Parameters<typeof useDraftMaterialization>[0],
    );
    const first = materialization.eagerStartSession("project-1");
    await flushAsync();
    const second = materialization.eagerStartSession("project-1");
    await flushAsync();

    secondStart.resolve({ sessionId: "newer-session", pid: 2 });
    await second;
    firstStart.resolve({ sessionId: "older-session", pid: 1 });
    await first;

    expect(params.refs.preStartedSessionIdRef.current).toBe("newer-session");
    expect(params.setters.setPreStartedSessionId).toHaveBeenCalledTimes(1);
    expect(params.setters.setPreStartedSessionId).toHaveBeenCalledWith("newer-session");
    expect(window.claude.stop).toHaveBeenCalledWith("older-session", "draft_abandoned");
  });

  it("stops a session that resolves after abandoning a pending eager start", async () => {
    const { useDraftMaterialization } = await import("../useDraftMaterialization");
    const params = makeParams();
    const start = deferred<{ sessionId: string; pid: number }>();
    vi.mocked(window.claude.start).mockReturnValue(start.promise);

    const materialization = useDraftMaterialization(
      params as unknown as Parameters<typeof useDraftMaterialization>[0],
    );
    const pending = materialization.eagerStartSession("project-1");
    await flushAsync();
    materialization.abandonEagerSession("deselect");
    start.resolve({ sessionId: "abandoned-session", pid: 1 });
    await pending;

    expect(params.refs.preStartedSessionIdRef.current).toBeNull();
    expect(params.setters.setPreStartedSessionId).not.toHaveBeenCalled();
    expect(window.claude.stop).toHaveBeenCalledWith("abandoned-session", "draft_abandoned");
  });
});
