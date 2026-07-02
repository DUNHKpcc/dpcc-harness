import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetDataDir,
  mockResolveCodexUpstream,
  testDataDir,
} = vi.hoisted(() => {
  const osMod = require("os") as typeof import("os");
  const pathMod = require("path") as typeof import("path");
  return {
    mockGetDataDir: vi.fn(),
    mockResolveCodexUpstream: vi.fn(),
    testDataDir: pathMod.join(osMod.tmpdir(), "pcc-agent-codex-home-isolation-test"),
  };
});

vi.mock("../data-dir", () => ({
  getDataDir: mockGetDataDir,
}));

vi.mock("../upstream-resolver", () => ({
  resolveCodexUpstream: mockResolveCodexUpstream,
}));

async function loadModule() {
  vi.resetModules();
  return import("../codex-home-isolation");
}

describe("codex home isolation", () => {
  beforeEach(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    mockGetDataDir.mockReset();
    mockResolveCodexUpstream.mockReset();
    mockGetDataDir.mockReturnValue(testDataDir);
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "dpcc-codex",
    });
  });

  it("sets an app-owned CODEX_HOME and writes a minimal provider config for non-local upstreams", async () => {
    const { buildCodexAppServerEnv } = await loadModule();

    const env = buildCodexAppServerEnv({ PATH: "/usr/bin" });
    const codexHome = path.join(testDataDir, "codex-home");

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      RUST_LOG: "warn",
      CODEX_HOME: codexHome,
      PCCAGENT_GATEWAY_API_KEY: "sk-dpcc",
    });
    const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf-8");
    expect(config).toContain('model_provider = "pcc-agent-gateway"');
    expect(config).toContain('model = "dpcc-codex"');
    expect(config).toContain('base_url = "https://api.dpcc.example/v1"');
    expect(config).toContain('env_key = "PCCAGENT_GATEWAY_API_KEY"');
    expect(config).not.toContain("sk-dpcc");
    expect(config).not.toContain("[mcp_servers.");
  });

  it("does not override CODEX_HOME when the user explicitly selects local Codex config", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "local",
      providerName: "local-provider",
      baseUrl: "https://local.example/v1",
      apiKey: "",
      model: "local-model",
    });
    const { buildCodexAppServerEnv } = await loadModule();

    const env = buildCodexAppServerEnv({ PATH: "/usr/bin", CODEX_HOME: "/Users/me/.codex" });

    expect(env.CODEX_HOME).toBe("/Users/me/.codex");
    expect(env).not.toHaveProperty("PCCAGENT_GATEWAY_API_KEY");
    expect(fs.existsSync(path.join(testDataDir, "codex-home", "config.toml"))).toBe(false);
  });

  it("preserves an explicit RUST_LOG value", async () => {
    const { buildCodexAppServerEnv } = await loadModule();

    const env = buildCodexAppServerEnv({ RUST_LOG: "debug" });

    expect(env.RUST_LOG).toBe("debug");
  });
});
