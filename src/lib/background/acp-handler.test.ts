import { describe, expect, it } from "vitest";
import type { ACPSessionEvent, ACPTurnCompleteEvent, ACPTransportErrorEvent } from "@/types";
import type { UIMessage } from "@/types";
import type { InternalState } from "./session-store";
import {
  handleACPEvent,
  handleACPTransportError,
  handleACPTurnComplete,
} from "./acp-handler";

function makeState(messages: UIMessage[] = []): InternalState {
  return {
    messages,
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
    parentToolMap: new Map(),
    currentStreamingMsgId: null,
    activeTask: null,
    turnSawCompaction: false,
    turnSawOutput: false,
    terminalAcpTurnIdSet: new Set(),
  };
}

function pendingTool(id: string, toolName = "Read"): UIMessage {
  return {
    id,
    role: "tool_call",
    content: "",
    toolName,
    timestamp: 1,
  };
}

function streamingMessage(): UIMessage {
  return {
    id: "assistant-stream",
    role: "assistant",
    content: "partial",
    thinking: "thought",
    isStreaming: true,
    timestamp: 1,
  };
}

function completeEvent(
  turnId: string,
  status: ACPTurnCompleteEvent["status"],
): ACPTurnCompleteEvent {
  return {
    _sessionId: "session-1",
    turnId,
    status,
    ...(status === "cancelled" ? { stopReason: "cancelled" as const } : { stopReason: "end_turn" as const }),
    ...(status === "failed"
      ? {
          error: {
            code: "pi_retry_exhausted",
            message: "Pi upstream failed",
            source: "upstream" as const,
            stage: "prompt" as const,
            retryable: true,
          },
        }
      : {}),
    outcomeDelivered: true,
  };
}

function transportErrorEvent(turnId: string): ACPTransportErrorEvent {
  return {
    _sessionId: "session-1",
    turnId,
    status: "transport_error",
    error: {
      code: "acp_transport_error",
      message: "Connection closed",
      source: "harnss",
      stage: "prompt",
      retryable: true,
    },
    outcomeDelivered: false,
  };
}

describe("ACP turn terminal handlers", () => {
  it("completes a turn, closes pending tools, and is idempotent", () => {
    const state = makeState([streamingMessage(), pendingTool("tool-read")]);
    state.currentStreamingMsgId = "assistant-stream";
    state.activeTask = { msgId: "tool-task", toolCallId: "task-1", hasInnerTools: false, textBuffer: "" };

    handleACPTurnComplete(state, completeEvent("turn-1", "completed"));
    const afterFirst = structuredClone(state);
    handleACPTurnComplete(state, completeEvent("turn-1", "completed"));

    expect(state).toEqual(afterFirst);
    expect(state.isProcessing).toBe(false);
    expect(state.activeTask).toBeNull();
    expect(state.currentStreamingMsgId).toBeNull();
    expect(state.messages).toEqual([
      expect.objectContaining({ id: "assistant-stream", isStreaming: false, thinkingComplete: true }),
      expect.objectContaining({ id: "tool-read", toolResult: { status: "completed" } }),
    ]);
  });

  it("keeps cancellation distinct and fails pending tools", () => {
    const state = makeState([pendingTool("tool-read")]);

    handleACPTurnComplete(state, completeEvent("turn-cancelled", "cancelled"));
    const afterFirst = structuredClone(state);
    handleACPTurnComplete(state, completeEvent("turn-cancelled", "cancelled"));

    expect(state).toEqual(afterFirst);
    expect(state.isProcessing).toBe(false);
    expect(state.messages[0]).toMatchObject({
      toolError: true,
      toolResult: { status: "failed", content: "Agent turn cancelled." },
    });
    expect(state.messages.filter((message) => message.role === "system")).toHaveLength(0);
  });

  it("fails pending tools, emits one error, and is idempotent", () => {
    const state = makeState([
      pendingTool("tool-read"),
      { ...pendingTool("tool-task", "Task"), subagentStatus: "running" },
    ]);
    state.activeTask = { msgId: "tool-task", toolCallId: "task-1", hasInnerTools: true, textBuffer: "" };

    handleACPTurnComplete(state, completeEvent("turn-failed", "failed"));
    const afterFirst = structuredClone(state);
    handleACPTurnComplete(state, completeEvent("turn-failed", "failed"));

    expect(state).toEqual(afterFirst);
    expect(state.isProcessing).toBe(false);
    expect(state.activeTask).toBeNull();
    expect(state.messages[0]).toMatchObject({ toolError: true, toolResult: { status: "failed", content: "Pi upstream failed" } });
    expect(state.messages[1]).toMatchObject({ toolError: true, subagentStatus: "failed" });
    expect(state.messages.filter((message) => message.role === "system")).toHaveLength(1);
    expect(state.messages.at(-1)).toMatchObject({ role: "system", isError: true, content: "ACP prompt error: Pi upstream failed" });
  });

  it("cleans pending tools on transport error and ignores a duplicate", () => {
    const state = makeState([pendingTool("tool-read")]);

    handleACPTransportError(state, transportErrorEvent("turn-transport"));
    const afterFirst = structuredClone(state);
    handleACPTransportError(state, transportErrorEvent("turn-transport"));

    expect(state).toEqual(afterFirst);
    expect(state.isProcessing).toBe(false);
    expect(state.messages[0]).toMatchObject({ toolError: true, toolResult: { status: "failed", content: "Connection closed" } });
    expect(state.messages.filter((message) => message.role === "system")).toHaveLength(1);
    expect(state.messages.at(-1)).toMatchObject({ role: "system", isError: true, content: "ACP prompt error: Connection closed" });
  });

  it("deduplicates an older terminal event after a newer turn has settled", () => {
    const state = makeState([pendingTool("tool-read")]);

    handleACPTurnComplete(state, completeEvent("turn-1", "completed"));
    handleACPTurnComplete(state, completeEvent("turn-2", "failed"));
    const afterSecondTurn = structuredClone(state);

    // Event delivery can be replayed out of order during background/foreground
    // handoff. The old single-last-id guard would append a second failure here.
    handleACPTurnComplete(state, completeEvent("turn-1", "completed"));

    expect(state).toEqual(afterSecondTurn);
    expect(state.messages.filter((message) => message.role === "system")).toHaveLength(1);
  });

  it("accepts canonical ACP tool events before applying terminal cleanup", () => {
    const state = makeState();
    const event: ACPSessionEvent = {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "read-1",
        title: "Read",
        status: "completed",
        rawInput: { path: "README.md" },
        rawOutput: { content: "ok" },
      },
    };

    handleACPEvent(state, event);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "tool-read-1",
      toolName: "Read",
      toolResult: { content: "ok", stdout: "ok" },
    });
  });

  it("does not close a pending tool on an intermediate event before a failed turn", () => {
    const state = makeState([pendingTool("tool-read")]);

    handleACPEvent(state, {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "partial output" },
      },
    });
    expect(state.messages.find((message) => message.id === "tool-read")).not.toHaveProperty("toolResult");

    handleACPTurnComplete(state, completeEvent("turn-after-tool", "failed"));
    expect(state.messages.find((message) => message.id === "tool-read")).toMatchObject({
      toolError: true,
      toolResult: { status: "failed", content: "Pi upstream failed" },
    });
  });
});
