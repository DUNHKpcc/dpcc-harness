import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeChatBridgeConfig } from "@shared/types/wechat";
import type { WeChatConversationRecord } from "./store";

const state = vi.hoisted(() => ({
  conversations: {} as Record<string, WeChatConversationRecord>,
  saveSessionToDisk: vi.fn(async (data: Record<string, unknown>) => ({
    id: data.id,
    projectId: data.projectId,
    title: data.title,
  })),
  safeSend: vi.fn(),
  saveConversations: vi.fn(),
}));

vi.mock("./store", () => ({
  loadWeChatConversations: () => ({ ...state.conversations }),
  saveWeChatConversations: (value: Record<string, WeChatConversationRecord>) => {
    state.saveConversations(value);
    state.conversations = { ...value };
  },
}));

vi.mock("../safe-send", () => ({
  safeSend: state.safeSend,
}));

vi.mock("../session-store", () => ({
  isSessionDeleted: () => false,
  saveSessionToDisk: state.saveSessionToDisk,
}));

vi.mock("../data-dir", () => ({
  getSessionFilePath: () => "/path/that/does/not/exist",
}));

import { WeChatSessionSink } from "./session-sink";

const CONFIG: WeChatBridgeConfig = {
  enabled: true,
  defaultTool: "pi",
  workDir: "/tmp",
  projectId: "project-1",
  allowedUsers: [],
  permissionMode: "safe",
  model: "provider/model",
  maxTurns: 30,
};

function record(tool: WeChatConversationRecord["tool"], pccSessionId: string): WeChatConversationRecord {
  return {
    userId: "user-1",
    tool,
    pccSessionId,
    projectId: "project-1",
    resumeId: `${tool}-resume`,
    title: tool,
    createdAt: 1,
    lastUpdatedMs: 1,
  };
}

function createSink() {
  return new WeChatSessionSink({
    getMainWindow: () => null,
    getConfig: () => CONFIG,
    emit: vi.fn(),
  });
}

describe("WeChatSessionSink Pi identity", () => {
  beforeEach(() => {
    state.conversations = {};
    state.saveSessionToDisk.mockClear();
    state.safeSend.mockClear();
    state.saveConversations.mockClear();
  });

  it("keeps legacy conversation records read-only and selects only Pi records", () => {
    state.conversations = {
      "user-1:claude": record("claude", "legacy-session"),
      "user-1:pi": record("pi", "pi-session"),
    };
    const sink = createSink();

    expect(sink.allRecords()).toHaveLength(1);
    expect(sink.getRecordBySessionId("legacy-session")).toBeUndefined();
    expect(sink.getRecordBySessionId("pi-session")?.tool).toBe("pi");
  });

  it("writes every new WeChat session with the ACP/Pi runtime identity", async () => {
    const sink = createSink();
    const sessionId = await sink.ensureSession("user-1", "hello");

    expect(sessionId).toMatch(/^wechat-/);
    expect(state.saveSessionToDisk).toHaveBeenCalledWith(expect.objectContaining({
      engine: "acp",
      agentId: "pi-acp",
      source: "wechat",
      wechatUserId: "user-1",
      model: "provider/model",
    }));
    const payload = state.saveSessionToDisk.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("codexThreadId");
    expect(payload).not.toHaveProperty("codexRolloutPath");
  });

  it("forwards ACP updates and one canonical terminal channel", () => {
    const sink = createSink();
    sink.forwardEvent("pcc-session", {
      sessionId: "pi-session",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    });
    sink.forwardTerminal("pcc-session", {
      kind: "outcome",
      outcome: { status: "completed", turnId: "turn-1", stopReason: "end_turn" },
    });

    expect(state.safeSend.mock.calls[0][1]).toBe("acp:event");
    expect(state.safeSend.mock.calls[0][2]).toMatchObject({
      _sessionId: "pcc-session",
      sessionId: "pi-session",
    });
    expect(state.safeSend.mock.calls[1][1]).toBe("acp:turn_complete");
    expect(state.safeSend.mock.calls[1][2]).toMatchObject({
      _sessionId: "pcc-session",
      turnId: "turn-1",
      status: "completed",
      outcomeDelivered: true,
    });
  });

  it("forwards transport errors without fabricating a completed outcome", () => {
    const sink = createSink();
    sink.forwardTerminal("pcc-session", {
      kind: "transport_error",
      turnId: "turn-failed",
      error: {
        code: "pi_wechat_transport_error",
        message: "connection closed",
        source: "pi",
        stage: "prompt",
        retryable: true,
      },
    });

    expect(state.safeSend.mock.calls[0][1]).toBe("acp:turn_transport_error");
    expect(state.safeSend.mock.calls[0][2]).toMatchObject({
      turnId: "turn-failed",
      status: "transport_error",
      outcomeDelivered: false,
    });
  });
});
