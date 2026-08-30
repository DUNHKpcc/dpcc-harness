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
  return import("../effective-cli-config");
}

describe("effective CLI config", () => {
  beforeEach(() => {
    mockGetAppSetting.mockReset();
    mockLoadLocalClaudeEnv.mockReset();
    mockLoadLocalCodexProvider.mockReset();
    mockLoadAccountCredential.mockReset();
    mockCredentialTokenForEngine.mockReset();

    mockGetAppSetting.mockImplementation((key: string) => {
      if (key === "cliConfigSource") return "default";
      if (key === "claudeCliConfigSource") return "local";
      if (key === "codexCliConfigSource") return "gateway";
      if (key === "piCliConfigSource") return "default";
      if (key === "accountMode") return "unset";
      if (key === "claudeGateway") {
        return {
          enabled: true,
          baseUrl: "https://anthropic-gateway.example",
          authToken: "sk-gateway-claude",
          model: "gateway-claude",
        };
      }
      if (key === "codexGateway") {
        return {
          enabled: true,
          name: "Responses Gateway",
          baseUrl: "https://responses-gateway.example/v1",
          apiKey: "sk-gateway-codex",
          model: "gateway-codex",
        };
      }
      if (key === "piGateway") {
        return {
          enabled: false,
          name: "",
          baseUrl: "",
          apiKey: "",
          model: "",
          modelMappings: [],
        };
      }
      if (key === "dpccUpstream") {
        return {
          baseUrl: "https://api.dpcc.example",
          claudeToken: "sk-dpcc-claude",
          codexToken: "sk-dpcc-codex",
          claudeModel: "dpcc-claude",
          codexModel: "dpcc-codex",
          piModel: "pcc-agent-dpcc-codex/dpcc-pi",
        };
      }
      throw new Error(`unexpected setting key: ${key}`);
    });
    mockLoadLocalClaudeEnv.mockReturnValue({
      ANTHROPIC_BASE_URL: "https://local-claude.example",
      ANTHROPIC_AUTH_TOKEN: "sk-local-claude",
      ANTHROPIC_MODEL: "local-claude",
    });
    mockLoadLocalCodexProvider.mockReturnValue({
      provider: "local-codex",
      baseUrl: "https://local-codex.example/v1",
      model: "local-codex-model",
    });
    mockLoadAccountCredential.mockReturnValue({
      accessTokens: {
        claude: "sk-dpcc-claude",
        codex: "sk-dpcc-codex",
      },
    });
    mockCredentialTokenForEngine.mockImplementation(
      (credential: { accessTokens?: Record<string, string> } | null, engine: string) =>
        credential?.accessTokens?.[engine] ?? "",
    );
  });

  it("reports Pi as the only live effective runtime and keeps legacy fields empty", async () => {
    const { resolveEffectiveCliConfig } = await loadModule();

    expect(resolveEffectiveCliConfig()).toEqual({
      claude: {
        source: "default",
        providerName: null,
        baseUrl: null,
        maskedToken: null,
        model: null,
      },
      codex: {
        source: "default",
        providerName: null,
        baseUrl: null,
        maskedToken: null,
        model: null,
      },
      pi: {
        source: "default",
        providerName: "DPCC API (Claude) + DPCC API (Codex)",
        baseUrl: "https://api.dpcc.example | https://api.dpcc.example/v1",
        maskedToken: null,
        credentials: [
          { label: "Claude", maskedToken: "sk-d••••••aude" },
          { label: "Codex", maskedToken: "sk-d•••••odex" },
        ],
        model: "pcc-agent-dpcc-codex/dpcc-pi",
      },
    });
  });
});
