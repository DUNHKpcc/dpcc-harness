import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_ID } from "./types";

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

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

function setter() {
  return vi.fn((value: unknown) => value);
}

function makeParams() {
  const sessions = [{
    id: DRAFT_ID,
    projectId: "project-1",
    title: "Draft",
    createdAt: 1,
    lastMessageAt: 1,
    totalCost: 0,
    isActive: true,
    engine: "codex" as const,
    model: "gpt-5.5",
  }];

  return {
    refs: {
      activeSessionIdRef: { current: DRAFT_ID },
      sessionsRef: { current: sessions },
      backgroundStoreRef: { current: new Map() },
      projectsRef: { current: [] },
    },
    setters: {
      setSessions: setter(),
      setStartOptions: setter(),
      setInitialMessages: setter(),
      setInitialMeta: setter(),
      setInitialPermission: setter(),
      setInitialRawAcpPermission: setter(),
      setActiveSessionId: setter(),
      setDraftProjectId: setter(),
      setCachedModels: setter(),
    },
    projects: [],
    activeSessionId: DRAFT_ID,
    getProjectCwd: vi.fn(() => "/tmp/project"),
  };
}

describe("useSessionCache", () => {
  beforeEach(() => {
    cleanupEffects.splice(0);
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      claude: {
        sessions: { list: vi.fn(async () => []) },
        modelsCacheGet: vi.fn(async () => ({ models: [] })),
        modelsCacheRevalidate: vi.fn(async () => ({ models: [] })),
        codex: {
          binaryInfo: vi.fn(async () => ({})),
          listModels: vi.fn(async () => ({ models: [] })),
        },
      },
      requestIdleCallback: undefined,
      cancelIdleCallback: undefined,
    });
  });

  it("does not spawn Codex model prefetch while hydrating a Codex draft", async () => {
    const { useSessionCache } = await import("./useSessionCache");

    useSessionCache(makeParams() as unknown as Parameters<typeof useSessionCache>[0]);

    expect(window.claude.codex.binaryInfo).not.toHaveBeenCalled();
    expect(window.claude.codex.listModels).not.toHaveBeenCalled();
  });
});
