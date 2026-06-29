import { describe, expect, it } from "vitest";
import type { ResultEvent, UIMessage } from "../../types";
import type { BackgroundSessionState } from "./session-store";
import { BackgroundSessionStore } from "./session-store";

function resultEvent(sessionId: string): ResultEvent & { _sessionId: string } {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1,
    num_turns: 1,
    result: "ok",
    total_cost_usd: 0,
    session_id: sessionId,
    _sessionId: sessionId,
  } satisfies ResultEvent & { _sessionId: string };
}

function summaryMsg(): UIMessage {
  return {
    id: "compact-1",
    role: "summary",
    content: "",
    timestamp: 1,
    compactTrigger: "manual",
  };
}

function userMsg(): UIMessage {
  return { id: "user-1", role: "user", content: "/compact", timestamp: 0 };
}

function assistantMsg(content: string): UIMessage {
  return { id: "assistant-1", role: "assistant", content, timestamp: 2 };
}

function seedState(overrides: Partial<BackgroundSessionState>): BackgroundSessionState {
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

describe("compaction-only unread suppression across session switch", () => {
  it("suppresses the unread dot when seeding mid-compaction before the result arrives", () => {
    const store = new BackgroundSessionStore();
    let captured: boolean | undefined;
    store.onProcessingChange = (_id, _processing, suppressUnread) => {
      captured = suppressUnread;
    };

    // 用户在 /compact 的 summary 插入之后、该 turn 的 `result` 事件之前切走 ——
    // in-flight turn 属于 compaction-only。
    store.initFromState(
      "session-1",
      seedState({ messages: [userMsg(), summaryMsg()] }),
    );

    store.handleEvent(resultEvent("session-1"));

    expect(captured).toBe(true);
  });

  it("suppresses when seeding while compaction is still in progress", () => {
    const store = new BackgroundSessionStore();
    let captured: boolean | undefined;
    store.onProcessingChange = (_id, _processing, suppressUnread) => {
      captured = suppressUnread;
    };

    store.initFromState(
      "session-1",
      seedState({ messages: [userMsg()], isCompacting: true }),
    );

    store.handleEvent(resultEvent("session-1"));

    expect(captured).toBe(true);
  });

  it("does NOT suppress when the turn produced real output after compaction", () => {
    const store = new BackgroundSessionStore();
    let captured: boolean | undefined;
    store.onProcessingChange = (_id, _processing, suppressUnread) => {
      captured = suppressUnread;
    };

    store.initFromState(
      "session-1",
      seedState({ messages: [userMsg(), summaryMsg(), assistantMsg("Done!")] }),
    );

    store.handleEvent(resultEvent("session-1"));

    expect(captured).toBeFalsy();
  });

  it("does NOT suppress an ordinary turn with no compaction", () => {
    const store = new BackgroundSessionStore();
    let captured: boolean | undefined;
    store.onProcessingChange = (_id, _processing, suppressUnread) => {
      captured = suppressUnread;
    };

    store.initFromState(
      "session-1",
      seedState({ messages: [userMsg(), assistantMsg("Hi")] }),
    );

    store.handleEvent(resultEvent("session-1"));

    expect(captured).toBeFalsy();
  });

  it("returns a deep clone from get() so callers cannot mutate nested message data", () => {
    const store = new BackgroundSessionStore();
    store.initFromState(
      "session-1",
      seedState({
        messages: [
          {
            id: "tool-1",
            role: "tool_call",
            content: "",
            timestamp: 1,
            toolName: "Edit",
            toolInput: { nested: { path: "before.ts" } },
          },
        ],
      }),
    );

    const firstRead = store.get("session-1");
    const toolInput = firstRead?.messages[0]?.toolInput as { nested: { path: string } };
    toolInput.nested.path = "after.ts";

    const secondRead = store.get("session-1");
    expect(secondRead?.messages[0]?.toolInput).toEqual({ nested: { path: "before.ts" } });
  });
});
