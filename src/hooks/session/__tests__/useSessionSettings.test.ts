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
      sessionsRef: { current: [] },
      liveSessionIdsRef: { current: new Set<string>() },
      backgroundStoreRef: { current: new Map() },
      preStartedSessionIdRef: { current: "prestarted-1" },
      draftProjectIdRef: { current: "project-1" },
      startOptionsRef: { current: { engine: "claude" as const } },
      sessionInfoRef: { current: null },
      codexRawModelsRef: { current: [] },
      claudeModelCatalogRequestGenerationRef: { current: 0 },
    },
    setters: {
      setSessions: setter(),
      setStartOptions: setter(),
      setPreStartedSessionId: setter(),
      setDraftMcpStatuses: setter(),
      setCachedModels: setter(),
    },
    engines: {
      claude: {},
      engine: {},
    },
    eagerStartSession: vi.fn(),
    abandonEagerSession: vi.fn(),
    resetCodexEffortToModelDefault: vi.fn(),
  };
}

describe("useSessionSettings", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      claude: {
        restartSession: vi.fn(),
        mcpStatus: vi.fn(async () => ({ servers: [] })),
        supportedModels: vi.fn(),
      },
    });
  });

  it("keeps an older draft model catalog response from overwriting a later restart", async () => {
    const { useSessionSettings } = await import("../useSessionSettings");
    const params = makeParams();
    const firstRestart = deferred<Record<string, never>>();
    const secondRestart = deferred<Record<string, never>>();
    const firstModels = [{ value: "first", displayName: "First", description: "" }];
    const secondModels = [{ value: "second", displayName: "Second", description: "" }];

    vi.mocked(window.claude.restartSession)
      .mockReturnValueOnce(firstRestart.promise)
      .mockReturnValueOnce(secondRestart.promise);
    vi.mocked(window.claude.supportedModels)
      .mockResolvedValueOnce({ models: secondModels })
      .mockResolvedValueOnce({ models: firstModels });

    const settings = useSessionSettings(
      params as unknown as Parameters<typeof useSessionSettings>[0],
    );

    const firstUpdate = settings.setActiveClaudeModelAndEffort("first", "low");
    const secondUpdate = settings.setActiveClaudeModelAndEffort("second", "high");

    secondRestart.resolve({});
    await secondUpdate;
    firstRestart.resolve({});
    await firstUpdate;

    expect(params.setters.setCachedModels).toHaveBeenCalledTimes(1);
    expect(params.setters.setCachedModels).toHaveBeenCalledWith(secondModels, undefined);
  });
});
