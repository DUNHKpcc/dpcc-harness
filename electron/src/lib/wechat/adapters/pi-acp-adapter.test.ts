import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecOptions } from "./types";

interface FakeClient {
  sessionUpdate: (params: Record<string, unknown>) => Promise<void>;
  requestPermission: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const state = vi.hoisted(() => ({
  cancelCalls: 0,
  launchArgs: ["-e", "setInterval(() => {}, 1000)"],
  loadError: null as Error | null,
  modelUpdates: [] as string[],
  newSessionId: "pi-session-new",
  permissionOptionIds: [] as string[],
  promptImpl: null as null | ((client: FakeClient, sessionId: string) => Promise<{ stopReason: string }>),
  promptStarted: false,
  resolvePrompt: null as null | ((value: { stopReason: string }) => void),
}));

vi.mock("../../pi-acp-config", () => ({
  preparePiAcpLaunch: async () => ({
    binary: process.execPath,
    args: state.launchArgs,
    env: { ...process.env },
    name: "Pi",
    adapterVersion: "0.0.33",
    piVersion: "0.84.1",
  }),
}));

vi.mock("../../process-tree", () => ({
  killProcessTree: (proc: { kill?: () => void } | null | undefined) => proc?.kill?.(),
}));

vi.mock("../../logger", () => ({ log: vi.fn() }));

vi.mock("@agentclientprotocol/sdk", () => ({
  PROTOCOL_VERSION: 1,
  ndJsonStream: () => ({}),
  ClientSideConnection: class FakeClientSideConnection {
    private readonly client: FakeClient;

    constructor(toClient: (agent: unknown) => FakeClient) {
      this.client = toClient({});
    }

    async initialize() {
      return { protocolVersion: 1, agentCapabilities: { loadSession: true } };
    }

    async newSession() {
      return { sessionId: state.newSessionId };
    }

    async loadSession() {
      if (state.loadError) throw state.loadError;
      return {};
    }

    async setSessionConfigOption(params: { value: string }) {
      state.modelUpdates.push(params.value);
      return { configOptions: [] };
    }

    async prompt(params: { sessionId: string }) {
      state.promptStarted = true;
      if (!state.promptImpl) return { stopReason: "end_turn" };
      return state.promptImpl(this.client, params.sessionId);
    }

    async cancel() {
      state.cancelCalls += 1;
      state.resolvePrompt?.({ stopReason: "cancelled" });
      return {};
    }
  },
}));

import { PiAcpAdapter } from "./pi-acp-adapter";

function options(overrides: Partial<AdapterExecOptions> = {}): AdapterExecOptions {
  return {
    workDir: process.cwd(),
    permissionMode: "safe",
    model: "",
    maxTurns: 30,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("PiAcpAdapter", () => {
  beforeEach(() => {
    state.cancelCalls = 0;
    state.launchArgs = ["-e", "setInterval(() => {}, 1000)"];
    state.loadError = null;
    state.modelUpdates = [];
    state.newSessionId = "pi-session-new";
    state.permissionOptionIds = [];
    state.promptImpl = null;
    state.promptStarted = false;
    state.resolvePrompt = null;
  });

  it("classifies retry-only Pi text as failure and never returns it as an answer", async () => {
    state.promptImpl = async (client, sessionId) => {
      for (const text of [
        "Retrying (attempt 1/3, waiting 2s)...",
        "Retrying (attempt 2/3, waiting 4s)...",
        "Retrying (attempt 3/3, waiting 8s)...",
        "Retry finished, resuming.",
      ]) {
        await client.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
        });
      }
      return { stopReason: "end_turn" };
    };

    const result = await new PiAcpAdapter().execute("hello", options());

    expect(result.error).toBe(true);
    expect(result.text).not.toContain("Retrying");
    expect(result.terminal).toMatchObject({
      kind: "outcome",
      outcome: { status: "failed", error: { code: "pi_retry_exhausted" } },
    });
  });

  it("completes when retry diagnostics are followed by meaningful output", async () => {
    state.promptImpl = async (client, sessionId) => {
      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Retrying (attempt 1/3, waiting 2s)..." },
        },
      });
      await client.sessionUpdate({
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "real answer" } },
      });
      return { stopReason: "end_turn" };
    };

    const result = await new PiAcpAdapter().execute("hello", options());

    expect(result.error).toBe(false);
    expect(result.text).toBe("real answer");
    expect(result.terminal).toMatchObject({ kind: "outcome", outcome: { status: "completed" } });
  });

  it("falls back to a fresh isolated Pi session only for a stale resume ID", async () => {
    state.loadError = new Error("Unknown sessionId: old-session");
    state.promptImpl = async (client, sessionId) => {
      await client.sessionUpdate({
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fresh" } },
      });
      return { stopReason: "end_turn" };
    };

    const result = await new PiAcpAdapter().execute("hello", options({ resumeId: "old-session" }));

    expect(result.sessionExpired).toBe(true);
    expect(result.resumeId).toBe("pi-session-new");
    expect(result.text).toBe("fresh");
  });

  it("rejects mutating permission requests in safe mode and allows them in auto mode", async () => {
    state.promptImpl = async (client, sessionId) => {
      const response = await client.requestPermission({
        sessionId,
        toolCall: { toolCallId: "tool-1", title: "edit", kind: "edit" },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      const outcome = response.outcome as { optionId?: string };
      state.permissionOptionIds.push(outcome.optionId ?? "cancelled");
      await client.sessionUpdate({
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
      });
      return { stopReason: "end_turn" };
    };

    await new PiAcpAdapter().execute("safe", options({ permissionMode: "safe" }));
    await new PiAcpAdapter().execute("auto", options({ permissionMode: "auto" }));

    expect(state.permissionOptionIds).toEqual(["reject", "allow"]);
  });

  it("cancels the ACP turn, kills the child, and preserves its resume ID", async () => {
    const controller = new AbortController();
    state.promptImpl = async () => new Promise<{ stopReason: string }>((resolve) => {
      state.resolvePrompt = resolve;
    });

    const resultPromise = new PiAcpAdapter().execute(
      "long turn",
      options({ signal: controller.signal, resumeId: "pi-resume" }),
    );
    while (!state.promptStarted) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const result = await resultPromise;

    expect(state.cancelCalls).toBe(1);
    expect(result.resumeId).toBe("pi-resume");
    expect(result.terminal).toMatchObject({ kind: "outcome", outcome: { status: "cancelled" } });
  });

  it("fails immediately when the Pi ACP child exits during a pending prompt", async () => {
    state.launchArgs = ["-e", "setTimeout(() => process.exit(7), 75)"];
    state.promptImpl = async () => new Promise<{ stopReason: string }>(() => {});

    const result = await Promise.race([
      new PiAcpAdapter().execute("pending turn", options()),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("adapter did not observe child exit")), 1_000);
      }),
    ]);

    expect(result.terminal).toMatchObject({
      kind: "transport_error",
      error: { code: "pi_wechat_child_exit", stage: "prompt" },
    });
  });
});
