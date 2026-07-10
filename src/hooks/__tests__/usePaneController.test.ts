import { describe, expect, it, vi } from "vitest";
import { usePaneController, type PaneControllerContext } from "../usePaneController";
import type { SessionPaneState } from "../session/useSessionPane";

vi.mock("react", () => ({
  useMemo: <T,>(factory: () => T) => factory(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const cachedModels = [{ value: "cached-model", displayName: "Cached model", description: "" }];

function makePaneState(supportedModelsLoaded: boolean): SessionPaneState {
  return {
    claude: {
      supportedModels: [],
      supportedModelsLoaded,
      send: vi.fn(),
    },
    acp: { setConfig: vi.fn() },
    codex: {
      codexModels: [],
      codexEffort: "",
      setPermissionMode: vi.fn(),
      send: vi.fn(),
    },
    engine: { slashCommands: [], interrupt: vi.fn() },
    isConnected: true,
  } as unknown as SessionPaneState;
}

function makeContext(): PaneControllerContext {
  return {
    agents: [],
    selectedAgent: null,
    settings: {
      getModelForEngine: () => "default-model",
      permissionMode: "default",
      planMode: false,
      claudeEffort: "medium",
      acpPermissionBehavior: "ask",
    },
    handleModelChange: vi.fn(),
    handleClaudeModelEffortChange: vi.fn(),
    handlePlanModeChange: vi.fn(),
    handlePermissionModeChange: vi.fn(),
    handleAgentChange: vi.fn(),
    handleStop: vi.fn(),
    handleComposerClear: vi.fn(),
    wrappedHandleSend: vi.fn(),
    manager: {
      setSessionModel: vi.fn(),
      setSessionClaudeModelAndEffort: vi.fn(),
      setSessionPlanMode: vi.fn(),
      setSessionPermissionMode: vi.fn(),
      setCodexEffort: vi.fn(),
      codexEffort: "",
      codexRawModels: [],
      codexModelsLoadingMessage: null,
      cachedClaudeModels: cachedModels,
      acpConfigOptions: [],
      acpConfigOptionsLoading: false,
      setACPConfig: vi.fn(),
    },
  };
}

describe("usePaneController", () => {
  it("keeps a loaded-empty Claude catalog empty instead of falling back to cached models", () => {
    const controller = usePaneController(
      "session-1",
      { id: "session-1", engine: "claude", model: "current-model" } as never,
      makePaneState(true),
      false,
      makeContext(),
    );

    expect(controller.paneSupportedModels).toEqual([]);
  });

  it("uses cached Claude models before the live catalog has loaded", () => {
    const controller = usePaneController(
      "session-1",
      { id: "session-1", engine: "claude", model: "current-model" } as never,
      makePaneState(false),
      false,
      makeContext(),
    );

    expect(controller.paneSupportedModels).toContainEqual(cachedModels[0]);
  });
});
