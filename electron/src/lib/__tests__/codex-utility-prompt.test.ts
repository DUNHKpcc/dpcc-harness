import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSpawn,
  mockGetCodexBinaryPath,
  mockResolveCodexUpstream,
  mockRequests,
  mockInstances,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockGetCodexBinaryPath: vi.fn(),
  mockResolveCodexUpstream: vi.fn(),
  mockRequests: [] as Array<{ method: string; params: Record<string, unknown> }>,
  mockInstances: [] as Array<{
    onNotification?: (msg: { method: string; params?: unknown }) => void;
    onStderr?: (text: string) => void;
    request: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("../codex-binary", () => ({
  getCodexBinaryPath: mockGetCodexBinaryPath,
}));

vi.mock("../upstream-resolver", () => ({
  resolveCodexUpstream: mockResolveCodexUpstream,
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
    mockRequests.length = 0;
    mockInstances.length = 0;

    mockGetCodexBinaryPath.mockResolvedValue("/bin/codex");
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

    expect(mockSpawn).toHaveBeenCalledWith("/bin/codex", ["app-server"], expect.objectContaining({
      env: expect.objectContaining({ PCCAGENT_GATEWAY_API_KEY: "sk-dpcc" }),
    }));
    const threadStart = mockRequests.find((r) => r.method === "thread/start")?.params;
    expect(threadStart).toMatchObject({
      modelProvider: "pcc-agent-gateway",
      model: "dpcc-codex",
      config: expect.objectContaining({
        "model_providers.pcc-agent-gateway.name": "DPCC API",
        "model_providers.pcc-agent-gateway.base_url": "https://api.dpcc.example/v1",
        "model_providers.pcc-agent-gateway.env_key": "PCCAGENT_GATEWAY_API_KEY",
        "model_providers.pcc-agent-gateway.wire_api": "responses",
        "model_providers.pcc-agent-gateway.requires_openai_auth": false,
      }),
    });
  });
});
