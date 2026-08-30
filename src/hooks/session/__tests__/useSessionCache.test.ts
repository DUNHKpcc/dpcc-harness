import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedSession } from "@/types";
import { DRAFT_ID } from "../types";

const { cleanupEffects } = vi.hoisted(() => ({
  cleanupEffects: [] as Array<() => void>,
}));

vi.mock("react", () => ({
  startTransition: (fn: () => void) => fn(),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanupEffects.push(cleanup);
  },
  useRef: <T,>(value: T) => ({ current: value }),
}));

function makePayload(id: string, overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    id,
    projectId: "project-1",
    title: id,
    createdAt: 1,
    messages: [],
    totalCost: 0,
    requestLog: [],
    ...overrides,
  };
}

function applySetter<T>(target: { value: T }, value: T | ((previous: T) => T)): void {
  target.value = typeof value === "function"
    ? (value as (previous: T) => T)(target.value)
    : value;
}

function makeParams(initialSessions: Array<Record<string, unknown>> = []) {
  const sessionState = { value: initialSessions as never[] };
  const startOptionsState = { value: { engine: "acp" as const, agentId: "pi-acp" } };
  const setters = {
    setSessions: vi.fn((value: never[] | ((previous: never[]) => never[])) => applySetter(sessionState, value)),
    setStartOptions: vi.fn((value: typeof startOptionsState.value | ((previous: typeof startOptionsState.value) => typeof startOptionsState.value)) => applySetter(startOptionsState, value)),
    setInitialMessages: vi.fn(),
    setInitialMeta: vi.fn(),
    setInitialConfigOptions: vi.fn(),
    setInitialSlashCommands: vi.fn(),
    setInitialPermission: vi.fn(),
    setInitialRawAcpPermission: vi.fn(),
    setAcpConfigOptionsLoading: vi.fn(),
    setActiveSessionId: vi.fn(),
    setDraftProjectId: vi.fn(),
  };
  return {
    refs: {
      activeSessionIdRef: { current: DRAFT_ID },
      sessionsRef: { current: initialSessions as never[] },
      installedAgentsRef: {
        current: [{
          id: "pi-acp",
          cachedConfigOptions: [{
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "cached/pi-model",
            options: [{ value: "cached/pi-model", name: "Cached Pi Model" }],
          }],
          cachedSlashCommands: [{
            name: "compact",
            description: "Compact context",
            source: "acp",
          }],
        }],
      },
      backgroundStoreRef: { current: new Map() },
    },
    setters,
    projects: [],
    activeSessionId: DRAFT_ID,
    getProjectCwd: vi.fn(),
    sessionState,
    startOptionsState,
  };
}

describe("useSessionCache", () => {
  beforeEach(() => {
    cleanupEffects.splice(0);
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      claude: {
        sessions: {
          list: vi.fn(async () => []),
          load: vi.fn(async (_projectId: string, id: string) => makePayload(id)),
        },
      },
      requestIdleCallback: undefined,
      cancelIdleCallback: undefined,
    });
  });

  it("prefetches recent payloads and serves a cache hit without another IPC load", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const session = {
      id: "recent-1",
      projectId: "project-1",
      title: "Recent",
      createdAt: 1,
      lastMessageAt: 2,
      isActive: false,
      engine: "acp",
      agentId: "pi-acp",
    };
    const params = makeParams([session]);
    const load = vi.mocked(window.claude.sessions.load);
    const cache = useSessionCache(params as never);

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(50);

    expect(load).toHaveBeenCalledWith("project-1", "recent-1");
    expect(cache.consumeCachedSessionPayload("recent-1")).toMatchObject({ id: "recent-1" });
    expect(cache.consumeCachedSessionPayload("recent-1")).toBeNull();
  });

  it("keeps only the six most recent payloads and removes a payload when consumed", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams();
    const cache = useSessionCache(params as never);

    for (let index = 0; index < 7; index += 1) {
      cache.cacheSessionPayload(makePayload(`session-${index}`));
    }

    expect(cache.consumeCachedSessionPayload("session-0")).toBeNull();
    expect(cache.consumeCachedSessionPayload("session-6")).toMatchObject({ id: "session-6" });
    expect(cache.consumeCachedSessionPayload("session-6")).toBeNull();
  });

  it("hydrates an ACP record without an agentId as Pi while leaving legacy records read-only", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams([
      {
        id: "legacy-1",
        projectId: "project-1",
        title: "Legacy",
        createdAt: 1,
        lastMessageAt: 1,
        isActive: false,
        engine: "codex",
      },
    ]);
    const cache = useSessionCache(params as never);

    cache.applyLoadedSession("legacy-1", makePayload("legacy-1", { engine: "codex", model: "old-model" }));
    const legacyOptions = params.setters.setStartOptions.mock.calls.at(-1)?.[0] as unknown as (previous: Record<string, unknown>) => Record<string, unknown>;
    expect(legacyOptions({ engine: "acp", agentId: "pi-acp" })).toMatchObject({
      engine: "codex",
      model: "old-model",
    });
    expect(legacyOptions({ engine: "acp", agentId: "pi-acp" }).agentId).toBeUndefined();
    expect(params.setters.setInitialConfigOptions).toHaveBeenLastCalledWith([]);
    expect(params.setters.setAcpConfigOptionsLoading).toHaveBeenLastCalledWith(false);

    cache.applyLoadedSession("pi-1", makePayload("pi-1", { engine: "acp", model: "pi-model" }));
    const piOptions = params.setters.setStartOptions.mock.calls.at(-1)?.[0] as unknown as (previous: Record<string, unknown>) => Record<string, unknown>;
    expect(piOptions({ engine: "claude" })).toMatchObject({
      engine: "acp",
      agentId: "pi-acp",
      model: "pi-model",
    });
    expect(params.setters.setInitialConfigOptions).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "model", currentValue: "cached/pi-model" }),
    ]);
    expect(params.setters.setInitialSlashCommands).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: "compact", source: "acp" }),
    ]);
  });

  it("keeps an unknown engine detached instead of guessing it is Claude", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams([{
      id: "invalid-1",
      projectId: "project-1",
      title: "Invalid",
      createdAt: 1,
      lastMessageAt: 1,
      isActive: false,
      invalidEngine: "future-runtime",
    }]);
    const cache = useSessionCache(params as never);

    cache.applyLoadedSession("invalid-1", makePayload("invalid-1", {
      invalidEngine: "future-runtime",
    }));
    const options = params.setters.setStartOptions.mock.calls.at(-1)?.[0] as unknown as (
      previous: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(options({ engine: "claude", agentId: "pi-acp" })).toMatchObject({
      engine: undefined,
      agentId: undefined,
    });
    const restoredSessions = params.sessionState.value as Array<Record<string, unknown>>;
    expect(restoredSessions.find((session) => session.id === "invalid-1"))
      .toMatchObject({ invalidEngine: "future-runtime", engine: undefined });
  });

  it("normalizes a raw unknown engine into the explicit invalid identity", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams([{
      id: "raw-invalid-1",
      projectId: "project-1",
      title: "Invalid",
      createdAt: 1,
      lastMessageAt: 1,
      engine: "future-runtime",
    }]);
    const cache = useSessionCache(params as never);

    cache.applyLoadedSession("raw-invalid-1", makePayload("raw-invalid-1", {
      engine: "future-runtime" as never,
    }));

    const restoredSessions = params.sessionState.value as Array<Record<string, unknown>>;
    expect(restoredSessions.find((session) => session.id === "raw-invalid-1"))
      .toMatchObject({ invalidEngine: "future-runtime", engine: undefined });
  });
});
