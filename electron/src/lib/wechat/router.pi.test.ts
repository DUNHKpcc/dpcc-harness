import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecOptions, AdapterExecResult, CLIAdapter } from "./adapters/types";
import type { ILinkClient, MessageHandler } from "./ilink-client";
import { WeChatRouter } from "./router";
import type { WeChatSessionSink } from "./session-sink";
import type { WeChatConversationRecord } from "./store";
import type { WeixinMessage } from "./types";
import type { WeChatBridgeConfig } from "@shared/types/wechat";

const CONFIG: WeChatBridgeConfig = {
  enabled: true,
  defaultTool: "pi",
  workDir: "/tmp",
  projectId: "project-1",
  allowedUsers: [],
  permissionMode: "safe",
  model: "",
  maxTurns: 30,
};

function completedResult(resumeId: string, text = "ok"): AdapterExecResult {
  return {
    text,
    resumeId,
    error: false,
    durationMs: 5,
    terminal: {
      kind: "outcome",
      outcome: { status: "completed", turnId: `turn-${resumeId}`, stopReason: "end_turn" },
    },
  };
}

function makeRecord(userId: string, pccSessionId: string, resumeId: string): WeChatConversationRecord {
  return {
    userId,
    tool: "pi",
    pccSessionId,
    projectId: "project-1",
    resumeId,
    title: userId,
    createdAt: 1,
    lastUpdatedMs: 1,
  };
}

function makeHarness(
  records: WeChatConversationRecord[],
  execute: (prompt: string, opts: AdapterExecOptions) => Promise<AdapterExecResult>,
) {
  let messageHandler: MessageHandler | undefined;
  const replies: Array<{ userId: string; text: string }> = [];
  const ilink = {
    onMessage: vi.fn((handler: MessageHandler) => {
      messageHandler = handler;
    }),
    startTyping: vi.fn(async () => vi.fn()),
    sendText: vi.fn(async (userId: string, text: string) => {
      replies.push({ userId, text });
    }),
  } as unknown as ILinkClient;

  const recordMap = new Map(records.map((record) => [record.userId, { ...record }]));
  const forwardedTerminals: unknown[] = [];
  const sink = {
    allRecords: vi.fn(() => [...recordMap.values()]),
    getRecord: vi.fn((userId: string) => recordMap.get(userId)),
    getRecordBySessionId: vi.fn((sessionId: string) =>
      [...recordMap.values()].find((record) => record.pccSessionId === sessionId)),
    ensureSession: vi.fn(async (userId: string) => recordMap.get(userId)!.pccSessionId),
    updateResume: vi.fn((userId: string, resumeId: string | undefined) => {
      const record = recordMap.get(userId);
      if (!record) return;
      if (resumeId) record.resumeId = resumeId;
      else delete record.resumeId;
    }),
    forwardEvent: vi.fn(),
    forwardTerminal: vi.fn((_sessionId: string, terminal: unknown) => {
      forwardedTerminals.push(terminal);
    }),
    finalizeTurn: vi.fn(async () => undefined),
  } as unknown as WeChatSessionSink;

  const adapter: CLIAdapter = {
    name: "pi",
    displayName: "Pi",
    isAvailable: vi.fn(async () => true),
    execute: vi.fn(execute),
  };
  const router = new WeChatRouter(ilink, adapter, () => CONFIG, vi.fn(), sink);
  router.start();

  return {
    adapter,
    forwardedTerminals,
    getMessageHandler: () => messageHandler,
    replies,
    router,
    sink,
  };
}

async function waitFor(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for router state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("WeChatRouter Pi ACP integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps resume IDs isolated per WeChat user", async () => {
    const harness = makeHarness(
      [makeRecord("user-a", "pcc-a", "pi-a"), makeRecord("user-b", "pcc-b", "pi-b")],
      async (_prompt, opts) => completedResult(`${opts.resumeId}-next`),
    );

    await harness.router.runFromDesktop("pcc-a", "first");
    await waitFor(() => vi.mocked(harness.adapter.execute).mock.calls.length === 1);
    await harness.router.runFromDesktop("pcc-b", "second");
    await waitFor(() => vi.mocked(harness.adapter.execute).mock.calls.length === 2);

    expect(vi.mocked(harness.adapter.execute).mock.calls[0][1].resumeId).toBe("pi-a");
    expect(vi.mocked(harness.adapter.execute).mock.calls[1][1].resumeId).toBe("pi-b");
    expect(vi.mocked(harness.sink.updateResume)).toHaveBeenCalledWith("user-a", "pi-a-next");
    expect(vi.mocked(harness.sink.updateResume)).toHaveBeenCalledWith("user-b", "pi-b-next");
  });

  it("rejects legacy aliases instead of silently routing them to Pi", async () => {
    const harness = makeHarness(
      [makeRecord("user-a", "pcc-a", "pi-a")],
      async () => completedResult("pi-a"),
    );
    const handler = harness.getMessageHandler();
    expect(handler).toBeTypeOf("function");

    handler?.({ from_user_id: "user-a" } as WeixinMessage, "@codex do work", "");
    await waitFor(() => harness.replies.length > 0);

    expect(harness.replies[0].text).toContain("请使用 @pi");
    expect(harness.adapter.execute).not.toHaveBeenCalled();
  });

  it("cancels the exact desktop WeChat turn and forwards a canonical terminal event", async () => {
    const harness = makeHarness(
      [makeRecord("user-a", "pcc-a", "pi-a")],
      async (_prompt, opts) => new Promise<AdapterExecResult>((resolve) => {
        opts.signal.addEventListener("abort", () => resolve({
          text: "已取消",
          resumeId: opts.resumeId,
          error: true,
          durationMs: 1,
          terminal: {
            kind: "outcome",
            outcome: { status: "cancelled", turnId: "turn-cancel", stopReason: "cancelled" },
          },
        }), { once: true });
      }),
    );

    await harness.router.runFromDesktop("pcc-a", "long task");
    await waitFor(() => vi.mocked(harness.adapter.execute).mock.calls.length === 1);
    expect(harness.router.cancelFromDesktop("pcc-a")).toEqual({ ok: true });
    await waitFor(() => harness.forwardedTerminals.length === 1);

    expect(harness.forwardedTerminals[0]).toMatchObject({
      kind: "outcome",
      outcome: { status: "cancelled", turnId: "turn-cancel" },
    });
    expect(vi.mocked(harness.sink.updateResume)).toHaveBeenCalledWith("user-a", "pi-a");
  });

  it("persists and forwards Pi failures instead of treating a resolved prompt as success", async () => {
    const harness = makeHarness(
      [makeRecord("user-a", "pcc-a", "pi-a")],
      async () => ({
        text: "运行失败: upstream unavailable",
        resumeId: "pi-a",
        error: true,
        durationMs: 5,
        terminal: {
          kind: "outcome",
          outcome: {
            status: "failed",
            turnId: "turn-failed",
            error: {
              code: "pi_retry_exhausted",
              message: "upstream unavailable",
              source: "upstream",
              stage: "prompt",
              retryable: true,
            },
          },
        },
      }),
    );

    await harness.router.runFromDesktop("pcc-a", "fail");
    await waitFor(() => harness.forwardedTerminals.length === 1);

    expect(vi.mocked(harness.sink.finalizeTurn)).toHaveBeenCalledWith(
      "user-a",
      "pi-a",
      "fail",
      "运行失败: upstream unavailable",
      true,
    );
    expect(harness.forwardedTerminals[0]).toMatchObject({
      kind: "outcome",
      outcome: { status: "failed", error: { code: "pi_retry_exhausted" } },
    });
  });
});
