import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_ID } from "../types";
import type { AppSettings } from "@shared/types/settings";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function modelSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    cliConfigSource: "default",
    claudeCliConfigSource: "default",
    claudeBinarySource: "auto",
    claudeCustomBinaryPath: "",
    claudeGateway: { enabled: false, baseUrl: "", authToken: "", model: "" },
    dpccUpstream: {
      baseUrl: "https://api.dpcc.example",
      claudeToken: "token-a",
      claudeModel: "claude-sonnet-4-6",
    },
    ...overrides,
  } as AppSettings;
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
      claudeModelCatalogRequestGenerationRef: { current: 0 },
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
      invalidateCachedModels: vi.fn(),
    },
    projects: [],
    activeSessionId: DRAFT_ID,
    getProjectCwd: vi.fn(() => "/tmp/project"),
  };
}

describe("useSessionCache", () => {
  let settingsListener: ((settings: AppSettings) => void) | null;

  beforeEach(() => {
    cleanupEffects.splice(0);
    settingsListener = null;
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      claude: {
        sessions: { list: vi.fn(async () => []) },
        modelsCacheGet: vi.fn(async () => ({ models: [] })),
        modelsCacheRevalidate: vi.fn(async () => ({ models: [] })),
        settings: {
          get: vi.fn(async () => modelSettings()),
          onChanged: vi.fn((callback: (settings: AppSettings) => void) => {
            settingsListener = callback;
            return vi.fn();
          }),
        },
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
    const { useSessionCache } = await import("../useSessionCache");

    useSessionCache(makeParams() as unknown as Parameters<typeof useSessionCache>[0]);

    expect(window.claude.codex.binaryInfo).not.toHaveBeenCalled();
    expect(window.claude.codex.listModels).not.toHaveBeenCalled();
  });

  it("clears cached models when the model cache successfully returns an empty catalog", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams();

    useSessionCache(params as unknown as Parameters<typeof useSessionCache>[0]);
    await Promise.resolve();

    expect(params.setters.setCachedModels).toHaveBeenCalledWith([], undefined);
  });

  it("keeps cached models when the model cache response reports an error", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams();
    vi.mocked(window.claude.modelsCacheGet).mockResolvedValue({
      models: [{ value: "stale-model", displayName: "Stale model", description: "" }],
      error: "cache unavailable",
    });

    useSessionCache(params as unknown as Parameters<typeof useSessionCache>[0]);
    await Promise.resolve();

    expect(params.setters.setCachedModels).not.toHaveBeenCalled();
  });

  it("ignores an older cache result that resolves after a newer revalidation", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams();
    const cachedResult = deferred<{ models: Array<{ value: string; displayName: string; description: string }> }>();
    vi.mocked(window.claude.modelsCacheGet).mockReturnValue(cachedResult.promise);
    vi.mocked(window.claude.modelsCacheRevalidate).mockResolvedValue({
      models: [{ value: "fresh-model", displayName: "Fresh model", description: "" }],
    });

    useSessionCache(params as unknown as Parameters<typeof useSessionCache>[0]);
    await vi.advanceTimersByTimeAsync(3000);

    expect(params.setters.setCachedModels).toHaveBeenCalledWith([
      { value: "fresh-model", displayName: "Fresh model", description: "" },
    ], undefined);

    cachedResult.resolve({
      models: [{ value: "stale-model", displayName: "Stale model", description: "" }],
    });
    await Promise.resolve();

    expect(params.setters.setCachedModels).toHaveBeenCalledTimes(1);
  });

  it("invalidates and refreshes the Claude catalog when its source settings change", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams();

    useSessionCache(params as unknown as Parameters<typeof useSessionCache>[0]);
    await Promise.resolve();
    vi.mocked(window.claude.modelsCacheRevalidate).mockClear();

    settingsListener?.(modelSettings({ claudeCliConfigSource: "local" }));
    await Promise.resolve();

    expect(params.setters.invalidateCachedModels).toHaveBeenCalledTimes(1);
    expect(window.claude.modelsCacheRevalidate).toHaveBeenCalledTimes(1);
  });

  it("does not refresh the Claude catalog for unrelated settings changes", async () => {
    const { useSessionCache } = await import("../useSessionCache");
    const params = makeParams();

    useSessionCache(params as unknown as Parameters<typeof useSessionCache>[0]);
    await Promise.resolve();
    vi.mocked(window.claude.modelsCacheRevalidate).mockClear();

    settingsListener?.(modelSettings());
    await Promise.resolve();

    expect(params.setters.invalidateCachedModels).not.toHaveBeenCalled();
    expect(window.claude.modelsCacheRevalidate).not.toHaveBeenCalled();
  });
});
