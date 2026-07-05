import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAppSetting,
  mockLoadLocalClaudeEnv,
  mockLoadLocalCodexProvider,
} = vi.hoisted(() => ({
  mockGetAppSetting: vi.fn(),
  mockLoadLocalClaudeEnv: vi.fn(),
  mockLoadLocalCodexProvider: vi.fn(),
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

vi.mock("../local-cli-config", () => ({
  loadLocalClaudeEnv: mockLoadLocalClaudeEnv,
  loadLocalCodexProvider: mockLoadLocalCodexProvider,
}));

async function loadModule() {
  vi.resetModules();
  return import("../upstream-resolver");
}

function mockSettings({
  cliConfigSource = "default",
  claudeCliConfigSource,
  codexCliConfigSource,
  claudeGateway = { enabled: false, baseUrl: "", authToken: "", model: "" },
  codexGateway = { enabled: false, name: "", baseUrl: "", apiKey: "", model: "" },
}: {
  cliConfigSource?: "default" | "local" | "gateway";
  claudeCliConfigSource?: "default" | "local" | "gateway";
  codexCliConfigSource?: "default" | "local" | "gateway";
  claudeGateway?: { enabled: boolean; baseUrl: string; authToken: string; model: string };
  codexGateway?: { enabled: boolean; name: string; baseUrl: string; apiKey: string; model: string };
} = {}) {
  const dpccUpstream = {
    baseUrl: "https://api.dpcc.example",
    claudeToken: "sk-dpcc-claude",
    codexToken: "sk-dpcc-codex",
    claudeModel: "dpcc-claude-model",
    codexModel: "dpcc-codex-model",
  };

  mockGetAppSetting.mockImplementation((key: string) => {
    if (key === "cliConfigSource") return cliConfigSource;
    if (key === "claudeCliConfigSource") return claudeCliConfigSource ?? cliConfigSource;
    if (key === "codexCliConfigSource") return codexCliConfigSource ?? cliConfigSource;
    if (key === "claudeGateway") return claudeGateway;
    if (key === "codexGateway") return codexGateway;
    if (key === "dpccUpstream") return dpccUpstream;
    throw new Error(`unexpected setting key: ${key}`);
  });
}

describe("upstream resolver", () => {
  beforeEach(() => {
    mockGetAppSetting.mockReset();
    mockLoadLocalClaudeEnv.mockReset();
    mockLoadLocalCodexProvider.mockReset();

    mockSettings();
    mockLoadLocalClaudeEnv.mockReturnValue({
      ANTHROPIC_BASE_URL: "https://local-claude.example",
      ANTHROPIC_AUTH_TOKEN: "sk-local-claude",
      ANTHROPIC_MODEL: "local-claude-model",
    });
    mockLoadLocalCodexProvider.mockReturnValue({
      provider: "local-provider",
      baseUrl: "https://local-codex.example/v1",
      model: "local-codex-model",
    });
  });

  it("uses the DPCC upstream by default over local Claude and Codex CLI configs", async () => {
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

  it("uses local Claude and Codex CLI configs when selected", async () => {
    mockSettings({ cliConfigSource: "local" });
    const { resolveClaudeUpstream, resolveCodexUpstream } = await loadModule();

    expect(resolveClaudeUpstream()).toEqual({
      tier: "local",
      baseUrl: "https://local-claude.example",
      token: "sk-local-claude",
      model: "local-claude-model",
    });
    expect(resolveCodexUpstream()).toEqual({
      tier: "local",
      providerName: "local-provider",
      baseUrl: "https://local-codex.example/v1",
      apiKey: "",
      model: "local-codex-model",
    });
  });

  it("uses independent config sources for Claude and Codex", async () => {
    mockSettings({
      claudeCliConfigSource: "local",
      codexCliConfigSource: "gateway",
      codexGateway: {
        enabled: false,
        name: "Gateway Provider",
        baseUrl: "https://responses-gateway.example/v1",
        apiKey: "sk-gateway-codex",
        model: "gateway-codex-model",
      },
    });
    const { resolveClaudeUpstream, resolveCodexUpstream } = await loadModule();

    expect(resolveClaudeUpstream()).toEqual({
      tier: "local",
      baseUrl: "https://local-claude.example",
      token: "sk-local-claude",
      model: "local-claude-model",
    });
    expect(resolveCodexUpstream()).toEqual({
      tier: "gateway",
      providerName: "Gateway Provider",
      baseUrl: "https://responses-gateway.example/v1",
      apiKey: "sk-gateway-codex",
      model: "gateway-codex-model",
    });
  });

  it("uses third-party gateway configs when selected", async () => {
    mockSettings({
      cliConfigSource: "gateway",
      claudeGateway: {
        enabled: false,
        baseUrl: "https://anthropic-gateway.example",
        authToken: "sk-gateway-claude",
        model: "gateway-claude-model",
      },
      codexGateway: {
        enabled: false,
        name: "Gateway Provider",
        baseUrl: "https://responses-gateway.example/v1",
        apiKey: "sk-gateway-codex",
        model: "gateway-codex-model",
      },
    });
    const { resolveClaudeUpstream, resolveCodexUpstream } = await loadModule();

    expect(resolveClaudeUpstream()).toEqual({
      tier: "gateway",
      baseUrl: "https://anthropic-gateway.example",
      token: "sk-gateway-claude",
      model: "gateway-claude-model",
    });
    expect(resolveCodexUpstream()).toEqual({
      tier: "gateway",
      providerName: "Gateway Provider",
      baseUrl: "https://responses-gateway.example/v1",
      apiKey: "sk-gateway-codex",
      model: "gateway-codex-model",
    });
  });

  it("falls back to DPCC default when the selected gateway is not configured", async () => {
    mockSettings({
      cliConfigSource: "gateway",
      claudeGateway: {
        enabled: false,
        baseUrl: "",
        authToken: "",
        model: "",
      },
      codexGateway: {
        enabled: false,
        name: "",
        baseUrl: "",
        apiKey: "",
        model: "",
      },
    });
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

  it("falls back to DPCC default when a Claude gateway only has a stale token", async () => {
    mockSettings({
      cliConfigSource: "gateway",
      claudeGateway: {
        enabled: false,
        baseUrl: "",
        authToken: "sk-stale-claude",
        model: "gateway-claude-model",
      },
    });
    const { resolveClaudeUpstream } = await loadModule();

    expect(resolveClaudeUpstream()).toEqual({
      tier: "default",
      baseUrl: "https://api.dpcc.example",
      token: "sk-dpcc-claude",
      model: "dpcc-claude-model",
    });
  });
});
