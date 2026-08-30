import { describe, expect, it, vi } from "vitest";
import { usePaneController, type PaneControllerContext } from "../usePaneController";
import type { SessionPaneState } from "../session/useSessionPane";

vi.mock("react", () => ({
  useMemo: <T,>(factory: () => T) => factory(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

function makePaneState(model = ""): SessionPaneState {
  return {
    acp: {
      setConfig: vi.fn(),
      sessionInfo: model ? { model, permissionMode: "default" } : null,
      slashCommands: [],
      configOptions: [],
      configOptionsLoading: false,
      send: vi.fn(),
      setMessages: vi.fn(),
      setIsProcessing: vi.fn(),
    },
    sessionInfo: model ? { model, permissionMode: "default" } : null,
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
    },
    handleAgentChange: vi.fn(),
    handleStop: vi.fn(),
    handleComposerClear: vi.fn(),
    wrappedHandleSend: vi.fn(),
    manager: {
      acpConfigOptions: [],
      acpConfigOptionsLoading: false,
      setACPConfig: vi.fn(),
    },
  };
}

describe("usePaneController", () => {
  it("uses the live ACP model as the pane authority", () => {
    const controller = usePaneController(
      "session-1",
      { id: "session-1", engine: "acp", agentId: "pi-acp", model: "persisted-model" } as never,
      makePaneState("live-model"),
      true,
      makeContext(),
    );

    expect(controller.paneModel).toBe("live-model");
  });

  it("prefers the current ACP model config over stale session metadata", () => {
    const context = makeContext();
    context.manager.acpConfigOptions = [{
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "provider/runtime-model",
      options: [],
    }];
    const controller = usePaneController(
      "session-1",
      { id: "session-1", engine: "acp", agentId: "pi-acp", model: "persisted-model" } as never,
      makePaneState("stale-live-model"),
      true,
      context,
    );

    expect(controller.paneModel).toBe("provider/runtime-model");
    expect(controller.paneHeaderModel).toBe("provider/runtime-model");
  });

  it("falls back to the persisted model when no live ACP model exists", () => {
    const controller = usePaneController(
      "session-1",
      { id: "session-1", engine: "acp", agentId: "pi-acp", model: "current-model" } as never,
      makePaneState(),
      false,
      makeContext(),
    );

    expect(controller.paneModel).toBe("current-model");
  });

  it("does not consult legacy Claude/Codex model catalogs", () => {
    const controller = usePaneController(
      "session-1",
      { id: "session-1", engine: "codex", model: "current-model" } as never,
      makePaneState(),
      false,
      makeContext(),
    );

    expect(controller.paneModel).toBe("current-model");
  });

  it("blocks send for a legacy pane before any ACP IPC call", async () => {
    const paneState = makePaneState();
    const controller = usePaneController(
      "session-1",
      { id: "session-1", engine: "claude", model: "current-model" } as never,
      paneState,
      false,
      makeContext(),
    );

    await controller.handlePaneSend("should not run");

    expect(paneState.acp.send).not.toHaveBeenCalled();
    expect(paneState.acp.setMessages).toHaveBeenCalled();
    expect(paneState.acp.setIsProcessing).toHaveBeenCalledWith(false);
  });

  it("does not expose an unknown persisted engine as a live pane engine", () => {
    const controller = usePaneController(
      "session-1",
      { id: "session-1", engine: "future-runtime" } as never,
      makePaneState(),
      false,
      makeContext(),
    );

    expect(controller.paneEngine).toBe("acp");
  });
});
