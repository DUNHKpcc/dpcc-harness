import { describe, expect, it } from "vitest";
import type {
  ACPSessionEvent,
  ACPTurnCompleteEvent,
  UIMessage,
} from "../../../types";
import { BackgroundSessionStore, type BackgroundSessionState } from "../session-store";

function seedState(overrides: Partial<BackgroundSessionState> = {}): BackgroundSessionState {
  return {
    messages: [],
    isProcessing: true,
    isConnected: true,
    isCompacting: false,
    sessionInfo: null,
    totalCost: 0,
    upstreamRequestCount: 0,
    requestLog: [],
    contextUsage: null,
    pendingPermission: null,
    rawAcpPermission: null,
    slashCommands: [],
    ...overrides,
  };
}

function pendingTool(id = "tool-read"): UIMessage {
  return {
    id,
    role: "tool_call",
    content: "",
    toolName: "Read",
    timestamp: 1,
  };
}

function failedTurn(turnId: string): ACPTurnCompleteEvent {
  return {
    _sessionId: "session-1",
    turnId,
    status: "failed",
    error: {
      code: "pi_retry_exhausted",
      message: "Pi upstream failed",
      source: "upstream",
      stage: "prompt",
      retryable: true,
    },
    outcomeDelivered: true,
  };
}

describe("ACP background state", () => {
  it("keeps intermediate output pending and applies one failed terminal outcome", () => {
    const store = new BackgroundSessionStore();
    store.initFromState("session-1", seedState({ messages: [pendingTool()] }));
    store.handleACPEvent({
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "partial output" },
      },
    } satisfies ACPSessionEvent);

    let completionCallbacks = 0;
    store.onProcessingChange = (_sessionId, isProcessing) => {
      if (!isProcessing) completionCallbacks += 1;
    };
    store.handleACPTurnComplete("session-1", failedTurn("turn-1"));
    store.handleACPTurnComplete("session-1", failedTurn("turn-1"));

    const state = store.get("session-1");
    expect(completionCallbacks).toBe(1);
    expect(state?.isProcessing).toBe(false);
    const failedTool = state?.messages.find((message) => message.id === "tool-read");
    expect(failedTool).toMatchObject({
      toolError: true,
      toolResult: expect.objectContaining({ status: "failed", content: "Pi upstream failed" }),
    });
    expect(state?.messages.some((message) => (
      message.role === "system"
      && message.isError
      && message.content === "ACP prompt error: Pi upstream failed"
    ))).toBe(true);
  });

  it("preserves terminal turn idempotence across a pane handoff snapshot", () => {
    const firstStore = new BackgroundSessionStore();
    firstStore.initFromState("session-1", seedState());
    firstStore.handleACPTurnComplete("session-1", failedTurn("turn-1"));
    const snapshot = firstStore.get("session-1");
    expect(snapshot?.terminalAcpTurnIds).toEqual(["turn-1"]);

    const secondStore = new BackgroundSessionStore();
    secondStore.initFromState("session-1", snapshot!);
    secondStore.handleACPTurnComplete("session-1", failedTurn("turn-1"));

    expect(secondStore.get("session-1")?.messages.filter((message) => (
      message.role === "system" && message.isError
    ))).toHaveLength(1);
  });

  it("deep-clones reads and clears stale permissions when the ACP child exits", () => {
    const store = new BackgroundSessionStore();
    store.initFromState("session-1", seedState({
      messages: [{
        ...pendingTool(),
        toolInput: { nested: { path: "before.ts" } },
      }],
      pendingPermission: {
        requestId: "request-1",
        toolName: "Read",
        toolInput: {},
        toolUseId: "tool-read",
      },
    }));

    const firstRead = store.get("session-1");
    (firstRead?.messages[0]?.toolInput as { nested: { path: string } }).nested.path = "after.ts";
    expect(store.get("session-1")?.messages[0]?.toolInput).toEqual({
      nested: { path: "before.ts" },
    });

    const cleared: string[] = [];
    store.onPermissionCleared = (sessionId) => cleared.push(sessionId);
    store.markDisconnected("session-1");
    expect(cleared).toEqual(["session-1"]);
    expect(store.get("session-1")?.pendingPermission).toBeNull();
  });
});
