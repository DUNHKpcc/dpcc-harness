import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadLocalClaudeEnv,
  mockClientAppEnv,
  mockResolveClaudeUpstream,
} = vi.hoisted(() => ({
  mockLoadLocalClaudeEnv: vi.fn(),
  mockClientAppEnv: vi.fn(),
  mockResolveClaudeUpstream: vi.fn(),
}));

vi.mock("../local-cli-config", () => ({
  loadLocalClaudeEnv: mockLoadLocalClaudeEnv,
}));

vi.mock("../sdk", () => ({
  clientAppEnv: mockClientAppEnv,
}));

vi.mock("../upstream-resolver", () => ({
  resolveClaudeUpstream: mockResolveClaudeUpstream,
}));

async function loadModule() {
  vi.resetModules();
  return import("../claude-gateway-env");
}

describe("claude gateway env", () => {
  beforeEach(() => {
    mockLoadLocalClaudeEnv.mockReset();
    mockClientAppEnv.mockReset();
    mockResolveClaudeUpstream.mockReset();

    mockLoadLocalClaudeEnv.mockReturnValue({});
    mockClientAppEnv.mockReturnValue({});
    mockResolveClaudeUpstream.mockReturnValue({
      tier: "default",
      baseUrl: "https://api.dpcc.example",
      token: "sk-dpcc",
      model: "",
    });
  });

  it("clears stale picker models when a resolved upstream has no configured model", async () => {
    const { claudeResolvedModel } = await loadModule();

    expect(claudeResolvedModel("deepseek-v4-pro")).toBeUndefined();
  });

  it("purges local Claude default model env when a gateway upstream is active", async () => {
    mockLoadLocalClaudeEnv.mockReturnValue({
      ANTHROPIC_BASE_URL: "https://local.example",
      ANTHROPIC_AUTH_TOKEN: "sk-local",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "deepseek-v4-pro",
      KEEP_ME: "1",
    });
    const { claudeSpawnEnv } = await loadModule();

    const env = claudeSpawnEnv();

    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.dpcc.example");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-dpcc");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBeUndefined();
    expect(env.KEEP_ME).toBe("1");
  });

  it("disables the user settings source when a gateway upstream is active", async () => {
    const { claudeSettingSources } = await loadModule();

    expect(claudeSettingSources()).toEqual(["project", "local"]);
  });

  it("keeps normal setting sources for local Claude upstream", async () => {
    mockResolveClaudeUpstream.mockReturnValue({
      tier: "local",
      baseUrl: "",
      token: "",
      model: "",
    });
    const { claudeSettingSources } = await loadModule();

    expect(claudeSettingSources()).toEqual(["user", "project", "local"]);
  });

  it("uses the resolved upstream model when configured", async () => {
    mockResolveClaudeUpstream.mockReturnValue({
      tier: "default",
      baseUrl: "https://api.dpcc.example",
      token: "sk-dpcc",
      model: "claude-sonnet-4-6",
    });
    const { claudeResolvedModel } = await loadModule();

    expect(claudeResolvedModel("deepseek-v4-pro")).toBe("claude-sonnet-4-6");
  });
});
