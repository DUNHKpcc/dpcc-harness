import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startUtilityRequest, type UtilityRequestEvent } from "../upstream-request-tracker";

const {
  mockSpawn,
  mockGetCodexBinaryPath,
  mockResolveCodexUpstream,
  mockGetDataDir,
  testDataDir,
  mockRequests,
  mockInstances,
} = vi.hoisted(() => {
  const osMod = require("os") as typeof import("os");
  const pathMod = require("path") as typeof import("path");
  return {
    mockSpawn: vi.fn(),
    mockGetCodexBinaryPath: vi.fn(),
    mockResolveCodexUpstream: vi.fn(),
    mockGetDataDir: vi.fn(),
    testDataDir: pathMod.join(osMod.tmpdir(), "pcc-agent-codex-utility-test"),
    mockRequests: [] as Array<{ method: string; params: Record<string, unknown> }>,
    mockInstances: [] as Array<{
      onNotification?: (msg: { method: string; params?: unknown }) => void;
      onStderr?: (text: string) => void;
      request: ReturnType<typeof vi.fn>;
      notify: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    }>,
  };
});

describe("startUtilityRequest", () => {
  it("emits one pending record and updates the same record on completion", () => {
    const events: UtilityRequestEvent[] = [];
    const now = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(25);
    const finish = startUtilityRequest(
      (event) => events.push(event),
      "session-1",
      "codex",
      "title",
      { id: "utility-1", now },
    );

    finish?.(true);
    finish?.(false);

    expect(events).toEqual([
      expect.objectContaining({
        _sessionId: "session-1",
        countDelta: 1,
        record: expect.objectContaining({ id: "utility-1", status: "pending", requestCount: 1 }),
      }),
      expect.objectContaining({
        _sessionId: "session-1",
        countDelta: 0,
        record: expect.objectContaining({ id: "utility-1", status: "completed", completedAt: 25 }),
      }),
    ]);
  });

  it("does not emit when no parent session can own the utility request", () => {
    const emit = vi.fn();

    expect(startUtilityRequest(emit, undefined, "claude", "commit")).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });
});

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("../codex-binary", () => ({
  getCodexBinaryPath: mockGetCodexBinaryPath,
}));

vi.mock("../upstream-resolver", () => ({
  resolveCodexUpstream: mockResolveCodexUpstream,
}));

vi.mock("../data-dir", () => ({
  getDataDir: mockGetDataDir,
}));

vi.mock("../logger", () => ({
  log: vi.fn(),
}));

vi.mock("../error-utils", () => ({
  reportError: (_label: string, err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock("../codex-rpc", () => ({
  CodexRpcClient: vi.fn().mockImplementation(function MockCodexRpcClient() {
    const instance = {
      onNotification: undefined as ((msg: { method: string; params?: unknown }) => void) | undefined,
      onStderr: undefined as ((text: string) => void) | undefined,
      request: vi.fn(async (method: string, params: Record<string, unknown>) => {
        mockRequests.push({ method, params });
        if (method === "model/list") return { data: [{ id: "dpcc-codex", isDefault: true }] };
        if (method === "thread/start") return { thread: { id: "thread-1" } };
        if (method === "turn/start") {
          queueMicrotask(() => {
            instance.onNotification?.({ method: "turn/started", params: { turn: { id: "turn-1" } } });
            instance.onNotification?.({
              method: "item/completed",
              params: { item: { type: "agentMessage", text: "ok" } },
            });
            instance.onNotification?.({
              method: "turn/completed",
              params: { turn: { id: "turn-1", status: "completed" } },
            });
          });
          return { turn: { id: "turn-1" } };
        }
        return {};
      }),
      notify: vi.fn(),
      destroy: vi.fn(),
    };
    mockInstances.push(instance);
    return instance;
  }),
}));

async function loadModule() {
  vi.resetModules();
  return import("../codex-utility-prompt");
}

describe("codexUtilityPrompt", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockGetCodexBinaryPath.mockReset();
    mockResolveCodexUpstream.mockReset();
    mockGetDataDir.mockReset();
    mockRequests.length = 0;
    mockInstances.length = 0;
    fs.rmSync(testDataDir, { recursive: true, force: true });

    mockGetCodexBinaryPath.mockResolvedValue("/bin/codex");
    mockGetDataDir.mockReturnValue(testDataDir);
    mockSpawn.mockReturnValue(Object.assign(new EventEmitter(), { pid: 1234 }));
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "dpcc-codex",
    });
  });

  it("routes one-shot Codex prompts through the effective upstream provider", async () => {
    const { codexUtilityPrompt } = await loadModule();

    await expect(codexUtilityPrompt("hello", "/tmp/project", "TEST")).resolves.toBe("ok");

    const spawnEnv = mockSpawn.mock.calls[0]?.[2]?.env;
    expect(spawnEnv).toMatchObject({
      PCCAGENT_GATEWAY_API_KEY: "sk-dpcc",
    });
    expect(spawnEnv?.CODEX_HOME).toContain(path.join(testDataDir, "codex-home"));
    expect(spawnEnv?.CODEX_HOME).not.toBe(path.join(testDataDir, "codex-home"));
    const threadStart = mockRequests.find((r) => r.method === "thread/start")?.params;
    expect(threadStart).toMatchObject({
      modelProvider: "pcc-agent-gateway",
      model: "dpcc-codex",
      config: expect.objectContaining({
        "model_providers.pcc-agent-gateway.name": "DPCC API",
        "model_providers.pcc-agent-gateway.base_url": "https://api.dpcc.example/v1",
        "model_providers.pcc-agent-gateway.env_key": "PCCAGENT_GATEWAY_API_KEY",
        "model_providers.pcc-agent-gateway.wire_api": "responses",
        "model_providers.pcc-agent-gateway.supports_websockets": false,
        "model_providers.pcc-agent-gateway.requires_openai_auth": false,
      }),
    });
  });

  it("uses the listed default model when the effective upstream has no configured model", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "",
    });
    const { codexUtilityPrompt } = await loadModule();

    await expect(codexUtilityPrompt("hello", "/tmp/project", "TEST")).resolves.toBe("ok");

    const threadStart = mockRequests.find((r) => r.method === "thread/start")?.params;
    const turnStart = mockRequests.find((r) => r.method === "turn/start")?.params;
    expect(threadStart).toMatchObject({
      modelProvider: "pcc-agent-gateway",
      model: "dpcc-codex",
    });
    expect(turnStart).toMatchObject({ model: "dpcc-codex" });
  });

  it("uses an explicit session model even when it is absent from the native model list", async () => {
    const { codexUtilityPrompt } = await loadModule();

    await expect(codexUtilityPrompt("hello", "/tmp/project", "TEST", {
      model: "selected-upstream-model",
    })).resolves.toBe("ok");

    expect(mockRequests.some((request) => request.method === "model/list")).toBe(false);
    const threadStart = mockRequests.find((request) => request.method === "thread/start")?.params;
    const turnStart = mockRequests.find((request) => request.method === "turn/start")?.params;
    expect(threadStart).toMatchObject({
      modelProvider: "pcc-agent-gateway",
      model: "selected-upstream-model",
    });
    expect(turnStart).toMatchObject({ model: "selected-upstream-model" });
  });

  it("does not inject a PccAgent provider override when local Codex config is selected", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "local",
      providerName: "local-provider",
      baseUrl: "https://local-codex.example/v1",
      apiKey: "",
      model: "local-codex-model",
    });
    const { codexUtilityPrompt } = await loadModule();

    await expect(codexUtilityPrompt("hello", "/tmp/project", "TEST")).resolves.toBe("ok");

    expect(mockSpawn).toHaveBeenCalledWith("/bin/codex", ["app-server"], expect.objectContaining({
      env: expect.not.objectContaining({
        CODEX_HOME: expect.any(String),
        PCCAGENT_GATEWAY_API_KEY: expect.any(String),
      }),
    }));
    const threadStart = mockRequests.find((r) => r.method === "thread/start")?.params;
    expect(threadStart).not.toHaveProperty("modelProvider");
    expect(threadStart).not.toHaveProperty("config");
  });
});
