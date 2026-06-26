import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAppSetting,
  mockLoadLocalClaudeEnv,
  mockLoadLocalCodexProvider,
  mockLocalClaudeGatewayTakesPriority,
  mockLocalCodexGatewayTakesPriority,
} = vi.hoisted(() => ({
  mockGetAppSetting: vi.fn(),
  mockLoadLocalClaudeEnv: vi.fn(),
  mockLoadLocalCodexProvider: vi.fn(),
  mockLocalClaudeGatewayTakesPriority: vi.fn(),
  mockLocalCodexGatewayTakesPriority: vi.fn(),
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

vi.mock("../local-cli-config", () => ({
  loadLocalClaudeEnv: mockLoadLocalClaudeEnv,
  loadLocalCodexProvider: mockLoadLocalCodexProvider,
  localClaudeGatewayTakesPriority: mockLocalClaudeGatewayTakesPriority,
  localCodexGatewayTakesPriority: mockLocalCodexGatewayTakesPriority,
}));

async function loadModule() {
  vi.resetModules();
  return import("../upstream-resolver");
}

describe("upstream resolver", () => {
  beforeEach(() => {
    mockGetAppSetting.mockReset();
    mockLoadLocalClaudeEnv.mockReset();
    mockLoadLocalCodexProvider.mockReset();
    mockLocalClaudeGatewayTakesPriority.mockReset();
    mockLocalCodexGatewayTakesPriority.mockReset();

    mockGetAppSetting.mockImplementation((key: string) => {
      if (key === "claudeGateway") return { enabled: false, baseUrl: "", authToken: "", model: "" };
      if (key === "codexGateway") return { enabled: false, name: "", baseUrl: "", apiKey: "", model: "" };
      if (key === "dpccUpstream") {
        return {
          baseUrl: "https://api.dpcc.example",
          claudeToken: "sk-dpcc-claude",
          codexToken: "sk-dpcc-codex",
          claudeModel: "dpcc-claude-model",
          codexModel: "dpcc-codex-model",
        };
      }
      throw new Error(`unexpected setting key: ${key}`);
    });
    mockLocalClaudeGatewayTakesPriority.mockReturnValue(true);
    mockLoadLocalClaudeEnv.mockReturnValue({
      ANTHROPIC_BASE_URL: "https://local-claude.example",
      ANTHROPIC_AUTH_TOKEN: "sk-local-claude",
      ANTHROPIC_MODEL: "local-claude-model",
    });
    mockLocalCodexGatewayTakesPriority.mockReturnValue(true);
    mockLoadLocalCodexProvider.mockReturnValue({
      provider: "local-provider",
      baseUrl: "https://local-codex.example/v1",
      model: "local-codex-model",
    });
  });

  it("uses the DPCC upstream over local Claude and Codex CLI configs unless a third-party gateway is enabled", async () => {
    const { resolveClaudeUpstream, resolveCodexUpstream } = await loadModule();

    expect(resolveClaudeUpstream()).toEqual({
      tier: "default",
      baseUrl: "https://api.dpcc.example",
      token: "sk-dpcc-claude",
      model: "dpcc-claude-model",
    });
    expect(resolveCodexUpstream()).toEqual({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc-codex",
      model: "dpcc-codex-model",
    });
  });
});
