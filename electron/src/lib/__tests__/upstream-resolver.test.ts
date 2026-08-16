import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAppSetting,
  mockLoadLocalClaudeEnv,
  mockLoadLocalCodexProvider,
  mockLoadAccountCredential,
  mockCredentialTokenForEngine,
} = vi.hoisted(() => ({
  mockGetAppSetting: vi.fn(),
  mockLoadLocalClaudeEnv: vi.fn(),
  mockLoadLocalCodexProvider: vi.fn(),
  mockLoadAccountCredential: vi.fn(),
  mockCredentialTokenForEngine: vi.fn(),
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

vi.mock("../local-cli-config", () => ({
  loadLocalClaudeEnv: mockLoadLocalClaudeEnv,
  loadLocalCodexProvider: mockLoadLocalCodexProvider,
}));

vi.mock("../account-credential-store", () => ({
  loadAccountCredential: mockLoadAccountCredential,
  credentialTokenForEngine: mockCredentialTokenForEngine,
}));

async function loadModule() {
  vi.resetModules();
  return import("../upstream-resolver");
}

function mockSettings({
  accountMode = "unset",
  cliConfigSource = "default",
  claudeCliConfigSource,
  codexCliConfigSource,
  piCliConfigSource,
  dpccBaseUrl = "https://api.dpcc.example",
  claudeGateway = { enabled: false, baseUrl: "", authToken: "", model: "" },
  codexGateway = { enabled: false, name: "", baseUrl: "", apiKey: "", model: "" },
  piGateway = { enabled: false, name: "", baseUrl: "", apiKey: "", model: "", modelMappings: [] },
}: {
  accountMode?: "unset" | "guest";
  cliConfigSource?: "default" | "local" | "gateway";
  claudeCliConfigSource?: "default" | "local" | "gateway";
  codexCliConfigSource?: "default" | "local" | "gateway";
  piCliConfigSource?: "default" | "local" | "gateway";
  dpccBaseUrl?: string;
  claudeGateway?: { enabled: boolean; baseUrl: string; authToken: string; model: string };
  codexGateway?: { enabled: boolean; name: string; baseUrl: string; apiKey: string; model: string };
  piGateway?: {
    enabled: boolean;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    modelMappings: Array<{ displayName: string; modelId: string }>;
  };
} = {}) {
  const dpccUpstream = {
    baseUrl: dpccBaseUrl,
    claudeToken: "sk-dpcc-claude",
    codexToken: "sk-dpcc-codex",
    claudeModel: "dpcc-claude-model",
    codexModel: "dpcc-codex-model",
    piModel: "pcc-agent-dpcc-claude/dpcc-pi-model",
  };

  mockGetAppSetting.mockImplementation((key: string) => {
    if (key === "accountMode") return accountMode;
    if (key === "cliConfigSource") return cliConfigSource;
    if (key === "claudeCliConfigSource") return claudeCliConfigSource ?? cliConfigSource;
    if (key === "codexCliConfigSource") return codexCliConfigSource ?? cliConfigSource;
    if (key === "piCliConfigSource") return piCliConfigSource ?? "default";
    if (key === "claudeGateway") return claudeGateway;
    if (key === "codexGateway") return codexGateway;
    if (key === "piGateway") return piGateway;
    if (key === "dpccUpstream") return dpccUpstream;
    throw new Error(`unexpected setting key: ${key}`);
  });
}

describe("upstream resolver", () => {
  beforeEach(() => {
    mockGetAppSetting.mockReset();
    mockLoadLocalClaudeEnv.mockReset();
    mockLoadLocalCodexProvider.mockReset();
    mockLoadAccountCredential.mockReset();
    mockCredentialTokenForEngine.mockReset();

    mockSettings();
    mockLoadAccountCredential.mockReturnValue({
      issuer: "",
      source: "legacy_manual",
      legacy: {
        claudeToken: "sk-dpcc-claude",
        codexToken: "sk-dpcc-codex",
      },
    });
    mockCredentialTokenForEngine.mockImplementation(
      (credential: { legacy?: { claudeToken?: string; codexToken?: string } } | null, engine: string) =>
        engine === "claude"
          ? credential?.legacy?.claudeToken ?? ""
          : credential?.legacy?.codexToken ?? "",
    );
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
    const { resolveClaudeUpstream, resolveCodexUpstream, resolvePiUpstream } = await loadModule();

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
    expect(resolvePiUpstream()).toEqual({
      tier: "default",
      providers: [
        {
          id: "pcc-agent-dpcc-claude",
          name: "DPCC API (Claude)",
          baseUrl: "https://api.dpcc.example",
          apiKey: "sk-dpcc-claude",
          api: "anthropic-messages",
          authHeader: true,
          models: [],
        },
        {
          id: "pcc-agent-dpcc-codex",
          name: "DPCC API (Codex)",
          baseUrl: "https://api.dpcc.example/v1",
          apiKey: "sk-dpcc-codex",
          api: "openai-completions",
          models: [],
        },
      ],
      model: "pcc-agent-dpcc-claude/dpcc-pi-model",
    });
  });

  it("keeps browser-authorized model traffic on the trusted DPCC resource origin", async () => {
    mockLoadAccountCredential.mockReturnValue({
      issuer: "https://origin-api.dpccgaming.xyz",
      source: "desktop",
      accessTokens: {
        claude: "sk-desktop-claude",
        codex: "sk-desktop-codex",
      },
    });
    mockCredentialTokenForEngine.mockImplementation(
      (
        credential: { accessTokens?: { claude?: string; codex?: string } } | null,
        engine: "claude" | "codex",
      ) => credential?.accessTokens?.[engine] ?? "",
    );
    const { resolveClaudeUpstream, resolveCodexUpstream } = await loadModule();

    expect(resolveClaudeUpstream()).toEqual({
      tier: "default",
      baseUrl: "https://origin-api.dpccgaming.xyz",
      token: "sk-desktop-claude",
      model: "dpcc-claude-model",
    });
    expect(resolveCodexUpstream()).toEqual({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://origin-api.dpccgaming.xyz/v1",
      apiKey: "sk-desktop-codex",
      model: "dpcc-codex-model",
    });
  });

  it("uses the origin DPCC API endpoint when no saved host overrides the default", async () => {
    mockSettings({ dpccBaseUrl: "" });
    const { resolveClaudeUpstream, resolveCodexUpstream } = await loadModule();

    expect(resolveClaudeUpstream().baseUrl).toBe("https://origin-api.dpccgaming.xyz");
    expect(resolveCodexUpstream().baseUrl).toBe("https://origin-api.dpccgaming.xyz/v1");
  });

  it("never injects saved DPCC credentials while in Guest mode", async () => {
    mockSettings({ accountMode: "guest" });
    const { resolveClaudeUpstream, resolveCodexUpstream } = await loadModule();

    expect(resolveClaudeUpstream()).toMatchObject({
      tier: "default",
      token: "",
    });
    expect(resolveCodexUpstream()).toMatchObject({
      tier: "default",
      apiKey: "",
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
        enabled: true,
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

  it("keeps the Pi config source independent from Claude and Codex", async () => {
    mockSettings({
      claudeCliConfigSource: "local",
      codexCliConfigSource: "default",
      piCliConfigSource: "gateway",
      piGateway: {
        enabled: true,
        name: "Pi Gateway",
        baseUrl: "https://pi-gateway.example/v1",
        apiKey: "sk-pi-gateway",
        model: "pi-model",
        modelMappings: [
          { displayName: "Pi Model", modelId: "pi-model" },
          { displayName: "Pi Alt", modelId: "pi-alt" },
        ],
      },
    });
    const { resolveClaudeUpstream, resolveCodexUpstream, resolvePiUpstream } = await loadModule();

    expect(resolveClaudeUpstream().tier).toBe("local");
    expect(resolveCodexUpstream().tier).toBe("default");
    expect(resolvePiUpstream()).toEqual({
      tier: "gateway",
      providers: [{
        id: "pcc-agent-gateway",
        name: "Pi Gateway",
        baseUrl: "https://pi-gateway.example/v1",
        apiKey: "sk-pi-gateway",
        api: "openai-completions",
        models: ["pi-model", "pi-alt"],
      }],
      model: "pcc-agent-gateway/pi-model",
    });
  });

  it("uses the user's Pi configuration unchanged in local mode", async () => {
    mockSettings({ piCliConfigSource: "local" });
    const { resolvePiUpstream } = await loadModule();

    expect(resolvePiUpstream()).toEqual({
      tier: "local",
      providers: [],
      model: "",
    });
  });

  it("uses third-party gateway configs when selected", async () => {
    mockSettings({
      cliConfigSource: "gateway",
      claudeGateway: {
        enabled: true,
        baseUrl: "https://anthropic-gateway.example",
        authToken: "sk-gateway-claude",
        model: "gateway-claude-model",
      },
      codexGateway: {
        enabled: true,
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

  it("falls back to DPCC default when the selected gateway is disabled", async () => {
    mockSettings({
      cliConfigSource: "gateway",
      claudeGateway: {
        enabled: false,
        baseUrl: "https://anthropic-gateway.example",
        authToken: "sk-gateway-claude",
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
