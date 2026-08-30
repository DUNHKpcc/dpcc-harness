import { describe, expect, it } from "vitest";
import type { ACPSessionEvent } from "../../../types";
import { handleACPEvent } from "../acp-handler";
import { BackgroundSessionStore, type InternalState } from "../session-store";

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
    activeTask: null,
    turnSawCompaction: false,
    turnSawOutput: false,
    terminalAcpTurnIdSet: new Set(),
  };
}

describe("background ACP context usage", () => {
  it("updates context and cost from ACP usage_update events", () => {
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

  it("preserves ACP request records while a background session is stored", () => {
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
        turnId: "turn-1",
        engine: "acp",
        model: "pi-model",
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
    });

    const restored = store.consume("session-1");

    expect(restored?.contextUsage).toEqual({
      inputTokens: 2500,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheCreationTokens: 0,
      contextWindow: 200_000,
    });
    expect(restored?.requestLog).toEqual([
      expect.objectContaining({
        id: "request-1",
        turnId: "turn-1",
        engine: "acp",
        costUSD: 0.03,
      }),
    ]);
    expect(restored?.upstreamRequestCount).toBe(7);
  });
});
