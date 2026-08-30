import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIpcMainHandle,
  mockResolveEffectiveCliConfig,
  mockResolveClaudeUpstream,
  mockResolveCodexUpstream,
  mockResolvePiUpstream,
  mockListPiUpstreamModels,
  mockFetchUpstreamModels,
} = vi.hoisted(() => ({
  mockIpcMainHandle: vi.fn(),
  mockResolveEffectiveCliConfig: vi.fn(),
  mockResolveClaudeUpstream: vi.fn(),
  mockResolveCodexUpstream: vi.fn(),
  mockResolvePiUpstream: vi.fn(),
  mockListPiUpstreamModels: vi.fn(),
  mockFetchUpstreamModels: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

vi.mock("../../lib/effective-cli-config", () => ({
  resolveEffectiveCliConfig: mockResolveEffectiveCliConfig,
}));

vi.mock("../../lib/upstream-resolver", () => ({
  resolveClaudeUpstream: mockResolveClaudeUpstream,
  resolveCodexUpstream: mockResolveCodexUpstream,
  resolvePiUpstream: mockResolvePiUpstream,
}));

vi.mock("../../lib/pi-acp-config", () => ({
  listPiUpstreamModels: mockListPiUpstreamModels,
}));

vi.mock("../../lib/upstream-models", () => ({
  fetchUpstreamModels: mockFetchUpstreamModels,
}));

vi.mock("../../lib/error-utils", () => ({
  reportError: (_label: string, err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

async function loadModule() {
  vi.resetModules();
  return import("../cc-config");
}

function handlerFor<T extends (...args: never[]) => unknown>(channel: string) {
  const call = mockIpcMainHandle.mock.calls.find(([registered]) => registered === channel);
  return call?.[1] as T | undefined;
}

describe("cc-config IPC", () => {
  beforeEach(() => {
    mockIpcMainHandle.mockReset();
    mockResolveEffectiveCliConfig.mockReset();
    mockResolveClaudeUpstream.mockReset();
    mockResolveCodexUpstream.mockReset();
    mockResolvePiUpstream.mockReset();
    mockListPiUpstreamModels.mockReset();
    mockFetchUpstreamModels.mockReset();

    mockResolveClaudeUpstream.mockReturnValue({
      tier: "default",
      baseUrl: "https://api.dpcc.example",
      token: "sk-claude",
      model: "",
    });
    mockResolveCodexUpstream.mockReturnValue({
      tier: "local",
      providerName: "my-local-provider",
      baseUrl: "https://local.example/v1",
      apiKey: "",
      model: "local-model",
    });
    mockResolvePiUpstream.mockReturnValue({
      tier: "local",
      providers: [],
      model: "",
    });
    mockListPiUpstreamModels.mockResolvedValue({ models: [], error: "local_provider_unreadable" });
    mockFetchUpstreamModels.mockResolvedValue({ models: ["claude-model"], error: null });
  });

  it("lists only Pi models and never probes removed Claude/Codex runtimes", async () => {
    const { register } = await loadModule();
    register();

    const modelsHandler = handlerFor<() => Promise<unknown>>("cc-config:models");
    expect(modelsHandler).toBeDefined();
    const result = await modelsHandler!();

    expect(mockResolveClaudeUpstream).not.toHaveBeenCalled();
    expect(mockResolveCodexUpstream).not.toHaveBeenCalled();
    expect(mockFetchUpstreamModels).not.toHaveBeenCalled();
    expect(mockResolvePiUpstream).toHaveBeenCalledTimes(1);
    expect(mockListPiUpstreamModels).toHaveBeenCalledWith({
      tier: "local",
      providers: [],
      model: "",
    });
    expect(result).toEqual({
      claude: { source: "default", models: [], error: null },
      codex: { source: "default", models: [], error: null },
      pi: { source: "local", models: [], error: "local_provider_unreadable" },
    });
  });

  it("fetches upstream models from user-entered gateway credentials", async () => {
    mockFetchUpstreamModels.mockResolvedValue({ models: ["upstream-a", "upstream-b"], error: null });

    const { register } = await loadModule();
    register();

    const probeHandler =
      handlerFor<(_event: unknown, input: { baseUrl: string; token: string }) => Promise<unknown>>("cc-config:probe-models");
    expect(probeHandler).toBeDefined();

    const result = await probeHandler!(null, { baseUrl: " https://gateway.example/v1 ", token: " sk-live " });

    expect(mockFetchUpstreamModels).toHaveBeenCalledWith("https://gateway.example/v1", "sk-live");
    expect(result).toEqual({ models: ["upstream-a", "upstream-b"], error: null });
  });
});
