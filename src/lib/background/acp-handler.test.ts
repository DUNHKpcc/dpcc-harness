import { describe, expect, it } from "vitest";
import type { ACPSessionEvent, ACPTurnCompleteEvent, ACPTransportErrorEvent } from "@/types";
import type { UIMessage } from "@/types";
import type { InternalState } from "./session-store";
import {
  handleACPEvent,
  handleACPTransportError,
  handleACPTurnComplete,
} from "./acp-handler";
import { PI_CONTEXT_BRIDGE_PREFIX } from "@/lib/pi-context-bridge";
import {
  clearPiContextSnapshots,
  getPiContextSnapshots,
} from "@/lib/pi-context-store";

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

  it("consumes Pi context bridge notifications without adding marker text to chat", () => {
    clearPiContextSnapshots("session-1");
    const state = makeState();
    const marker = `${PI_CONTEXT_BRIDGE_PREFIX}${JSON.stringify({
      version: 1,
      id: "compaction-1",
      capturedAt: 1_700_000_000_000,
      phase: "compacted",
      usedTokens: null,
      contextWindow: 128_000,
      breakdown: {
        systemPromptTokens: 500,
        toolTokens: 400,
        conversationTokens: 0,
        reservedOutputTokens: 2_000,
        freeTokens: 128_000,
      },
      compaction: {
        reason: "manual",
        tokensBefore: 120_000,
        summary: "Kept the active implementation plan.",
      },
    })}`;

    handleACPEvent(state, {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: marker },
      },
    }, { acceptsPiContextBridge: true });

    expect(getPiContextSnapshots("session-1")).toHaveLength(1);
    expect(state.contextUsage).toMatchObject({ inputTokens: 0, contextWindow: 128_000 });
    expect(state.messages).toEqual([
      expect.objectContaining({
        role: "summary",
        content: "Kept the active implementation plan.",
        compactTrigger: "manual",
      }),
    ]);
    expect(state.messages.some((message) => message.content.startsWith(PI_CONTEXT_BRIDGE_PREFIX))).toBe(false);
    clearPiContextSnapshots("session-1");
  });

  it("does not consume a context marker from an untrusted ACP agent", () => {
    clearPiContextSnapshots("session-1");
    const state = makeState();
    const marker = `${PI_CONTEXT_BRIDGE_PREFIX}${JSON.stringify({
      version: 1,
      id: "untrusted-marker",
      capturedAt: 1_700_000_000_000,
      phase: "settled",
      usedTokens: 1,
      contextWindow: 128_000,
    })}`;

    handleACPEvent(state, {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: marker },
      },
    });

    expect(getPiContextSnapshots("session-1")).toHaveLength(0);
    expect(state.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: marker }),
    ]);
  });

  it("preserves Pi Bash command titles and accumulates terminal metadata output", () => {
    const state = makeState();
    const command = "printf 'alpha\\nbeta\\n'";

    handleACPEvent(state, {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "bash-1",
        title: command,
        kind: "execute",
        status: "in_progress",
        content: [{ type: "terminal", terminalId: "bash-1" }],
        _meta: {
          terminal_info: { terminal_id: "bash-1", cwd: "/repo" },
        },
      },
    });

    expect(state.messages[0]).toMatchObject({
      id: "tool-bash-1",
      toolName: "Bash",
      toolInput: { command, cwd: "/repo" },
    });

    handleACPEvent(state, {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "bash-1",
        status: "in_progress",
        _meta: {
          terminal_output: { terminal_id: "bash-1", data: "alpha\n" },
        },
      },
    });
    handleACPEvent(state, {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "bash-1",
        status: "in_progress",
        _meta: {
          terminal_output: { terminal_id: "bash-1", data: "beta\n" },
        },
      },
    });

    expect(state.messages[0].toolResult).toMatchObject({
      stdout: "alpha\nbeta\n",
      status: "in_progress",
    });

    handleACPEvent(state, {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "bash-1",
        status: "completed",
        _meta: {
          terminal_exit: { terminal_id: "bash-1", exit_code: 0, signal: null },
        },
      },
    });

    expect(state.messages[0].toolResult).toMatchObject({
      stdout: "alpha\nbeta\n",
      exitCode: 0,
      signal: null,
      status: "completed",
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
