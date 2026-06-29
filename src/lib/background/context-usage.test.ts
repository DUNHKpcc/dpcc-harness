import { describe, expect, it } from "vitest";
import type {
  AssistantMessageEvent,
  ResultEvent,
  ACPSessionEvent,
  CodexSessionEvent,
} from "../../types";
import { extractAssistantContextUsage } from "@/lib/engine/protocol";
import { handleClaudeEvent } from "./claude-handler";
import { handleACPEvent } from "./acp-handler";
import { handleCodexEvent } from "./codex-handler";
import { BackgroundSessionStore, type InternalState } from "./session-store";

function createState(): InternalState {
  return {
    messages: [],
    isProcessing: false,
    isConnected: false,
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
    codexPlanText: "",
    codexPlanTurnCounter: 0,
    activeTask: null,
    turnSawCompaction: false,
    turnSawOutput: false,
  };
}

describe("extractAssistantContextUsage", () => {
  it("normalizes Claude assistant usage without casts at the call site", () => {
    const message: AssistantMessageEvent["message"] = {
      model: "claude-sonnet-4-5",
      id: "msg-1",
      role: "assistant",
      content: [],
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    };

    expect(extractAssistantContextUsage(message, 200_000)).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 80,
      cacheCreationTokens: 20,
      contextWindow: 200_000,
    });
  });

  it("returns null when the assistant snapshot has no usage payload", () => {
    const message: AssistantMessageEvent["message"] = {
      model: "claude-sonnet-4-5",
      id: "msg-1",
      role: "assistant",
      content: [],
    };

    expect(extractAssistantContextUsage(message, 200_000)).toBeNull();
  });

  it("keeps assistant token usage without fabricating a context window", () => {
    const message: AssistantMessageEvent["message"] = {
      model: "claude-opus-4-6[1m]",
      id: "msg-1",
      role: "assistant",
      content: [],
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    };

    expect(extractAssistantContextUsage(message, null)).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 80,
      cacheCreationTokens: 20,
      contextWindow: 0,
    });
  });
});

describe("background context usage tracking", () => {
  it("updates Claude background state from assistant usage and result context window", () => {
    const state = createState();

    const assistantEvent = {
      type: "assistant",
      session_id: "session-1",
      uuid: "uuid-1",
      message: {
        model: "claude-sonnet-4-5",
        id: "msg-1",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: {
          input_tokens: 1500,
          output_tokens: 250,
          cache_read_input_tokens: 40,
          cache_creation_input_tokens: 10,
        },
      },
      _sessionId: "session-1",
    } satisfies AssistantMessageEvent & { _sessionId: string };

    handleClaudeEvent(state, assistantEvent);

    expect(state.contextUsage).toEqual({
      inputTokens: 1500,
      outputTokens: 250,
      cacheReadTokens: 40,
      cacheCreationTokens: 10,
      contextWindow: 0,
    });

    const resultEvent = {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1,
      num_turns: 1,
      result: "ok",
      total_cost_usd: 0.01,
      session_id: "session-1",
      modelUsage: {
        primary: {
          inputTokens: 1500,
          outputTokens: 250,
          cacheReadInputTokens: 40,
          cacheCreationInputTokens: 10,
          webSearchRequests: 0,
          costUSD: 0.01,
          contextWindow: 1_000_000,
        },
      },
      _sessionId: "session-1",
    } satisfies ResultEvent & { _sessionId: string };

    handleClaudeEvent(state, resultEvent);

    expect(state.contextUsage).toEqual({
      inputTokens: 1500,
      outputTokens: 250,
      cacheReadTokens: 40,
      cacheCreationTokens: 10,
      contextWindow: 1_000_000,
    });
    expect((state as any).requestLog).toEqual([
      expect.objectContaining({
        id: "claude-result-session-1-1",
        engine: "claude",
        model: "primary",
        status: "completed",
        requestCount: 1,
        inputTokens: 1500,
        outputTokens: 250,
        cacheReadTokens: 40,
        cacheCreationTokens: 10,
        durationMs: 1,
        costUSD: 0.01,
      }),
    ]);
    expect((state as any).upstreamRequestCount).toBe(1);
  });

  it("keeps only recent Claude request details while preserving total request count", () => {
    const state = createState();

    for (let index = 1; index <= 12; index++) {
      handleClaudeEvent(state, {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1,
        num_turns: 1,
        result: "ok",
        total_cost_usd: 0.01,
        session_id: "session-1",
        modelUsage: {
          primary: {
            inputTokens: index,
            outputTokens: 1,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUSD: 0.01,
            contextWindow: 200_000,
          },
        },
        _sessionId: "session-1",
      } satisfies ResultEvent & { _sessionId: string });
    }

    expect((state as any).upstreamRequestCount).toBe(12);
    expect((state as any).requestLog).toHaveLength(10);
    expect((state as any).requestLog[0].id).toBe("claude-result-session-1-3");
    expect((state as any).requestLog.at(-1)?.id).toBe("claude-result-session-1-12");
  });

  it("updates ACP background state from usage_update events", () => {
    const state = createState();
    const event = {
      _sessionId: "session-1",
      sessionId: "agent-session-1",
      update: {
        sessionUpdate: "usage_update",
        used: 4096,
        size: 128_000,
        cost: { amount: 0.02, currency: "USD" },
      },
    } satisfies ACPSessionEvent;

    handleACPEvent(state, event);

    expect(state.contextUsage).toEqual({
      inputTokens: 4096,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      contextWindow: 128_000,
    });
    expect(state.totalCost).toBe(0.02);
  });

  it("updates Codex background state from token usage notifications", () => {
    const state = createState();
    const event = {
      _sessionId: "session-1",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            inputTokens: 5000,
            outputTokens: 500,
            cachedInputTokens: 100,
            totalTokens: 5600,
            reasoningOutputTokens: 0,
          },
          last: {
            inputTokens: 1200,
            outputTokens: 140,
            cachedInputTokens: 25,
            totalTokens: 1365,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 256_000,
        },
      },
    } satisfies CodexSessionEvent;

    handleCodexEvent(state, event);

    expect(state.contextUsage).toEqual({
      inputTokens: 1200,
      outputTokens: 140,
      cacheReadTokens: 25,
      cacheCreationTokens: 0,
      contextWindow: 256_000,
    });
    expect((state as any).requestLog).toEqual([
      expect.objectContaining({
        id: "codex-turn-turn-1",
        engine: "codex",
        status: "completed",
        requestCount: 1,
        inputTokens: 1200,
        outputTokens: 140,
        cacheReadTokens: 25,
        cacheCreationTokens: 0,
        reasoningOutputTokens: 0,
        note: "codex_cost_unavailable",
      }),
    ]);
    expect((state as any).upstreamRequestCount).toBe(1);
  });

  it("keeps a single Codex request record across start, usage, reroute, and completion", () => {
    const state = createState();

    handleCodexEvent(state, {
      _sessionId: "session-1",
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1" },
      },
    } as CodexSessionEvent);
    handleCodexEvent(state, {
      _sessionId: "session-1",
      method: "model/rerouted",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        fromModel: "gpt-5",
        toModel: "gpt-5.1",
        reason: "highRiskCyberActivity",
      },
    } as CodexSessionEvent);
    handleCodexEvent(state, {
      _sessionId: "session-1",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            inputTokens: 5000,
            outputTokens: 500,
            cachedInputTokens: 100,
            totalTokens: 5650,
            reasoningOutputTokens: 50,
          },
          last: {
            inputTokens: 1200,
            outputTokens: 140,
            cachedInputTokens: 25,
            totalTokens: 1380,
            reasoningOutputTokens: 15,
          },
          modelContextWindow: 256_000,
        },
      },
    } satisfies CodexSessionEvent);
    handleCodexEvent(state, {
      _sessionId: "session-1",
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1" },
      },
    } as CodexSessionEvent);

    expect((state as any).requestLog).toHaveLength(1);
    expect((state as any).upstreamRequestCount).toBe(1);
    expect((state as any).requestLog[0]).toMatchObject({
      id: "codex-turn-turn-1",
      engine: "codex",
      model: "gpt-5.1",
      status: "completed",
      requestCount: 1,
      inputTokens: 1200,
      outputTokens: 140,
      cacheReadTokens: 25,
      reasoningOutputTokens: 15,
      note: "codex_cost_unavailable",
    });
  });

  it("preserves context usage when background state is stored and restored", () => {
    const store = new BackgroundSessionStore();

    store.initFromState("session-1", {
      messages: [],
      isProcessing: true,
      isConnected: true,
      isCompacting: false,
      sessionInfo: null,
      totalCost: 0.5,
      upstreamRequestCount: 7,
      contextUsage: {
        inputTokens: 2500,
        outputTokens: 200,
        cacheReadTokens: 50,
        cacheCreationTokens: 0,
        contextWindow: 200_000,
      },
      requestLog: [{
        id: "request-1",
        engine: "claude",
        model: "claude-sonnet-4-5",
        status: "completed",
        startedAt: 100,
        completedAt: 200,
        requestCount: 1,
        inputTokens: 2500,
        outputTokens: 200,
        costUSD: 0.03,
      }],
      pendingPermission: null,
      rawAcpPermission: null,
      slashCommands: [],
    } as any);

    const restored = store.consume("session-1");

    expect(restored?.contextUsage).toEqual({
      inputTokens: 2500,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheCreationTokens: 0,
      contextWindow: 200_000,
    });
    expect((restored as any)?.requestLog).toEqual([
      expect.objectContaining({
        id: "request-1",
        engine: "claude",
        costUSD: 0.03,
      }),
    ]);
    expect((restored as any)?.upstreamRequestCount).toBe(7);
  });
});
