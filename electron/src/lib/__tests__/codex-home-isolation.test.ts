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
    const codexHome = env.CODEX_HOME as string;

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      RUST_LOG: "warn",
      PCCAGENT_GATEWAY_API_KEY: "sk-dpcc",
    });
    expect(codexHome).toContain(path.join(testDataDir, "codex-home"));
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

  it("clears inherited gateway API keys for local Codex config", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "local",
      providerName: "local-provider",
      baseUrl: "https://local.example/v1",
      apiKey: "",
      model: "local-model",
    });
    const { buildCodexAppServerEnv } = await loadModule();

    const env = buildCodexAppServerEnv({
      PCCAGENT_GATEWAY_API_KEY: "stale-key",
      CODEX_HOME: "/Users/me/.codex",
    });

    expect(env).not.toHaveProperty("PCCAGENT_GATEWAY_API_KEY");
    expect(env.CODEX_HOME).toBe("/Users/me/.codex");
  });

  it("clears inherited gateway API keys when a non-local upstream has no key", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "",
      model: "dpcc-codex",
    });
    const { buildCodexAppServerEnv } = await loadModule();

    const env = buildCodexAppServerEnv({ PCCAGENT_GATEWAY_API_KEY: "stale-key" });

    expect(env).not.toHaveProperty("PCCAGENT_GATEWAY_API_KEY");
  });

  it("does not reuse a stale isolated config when a non-local upstream has no base URL", async () => {
    const { buildCodexAppServerEnv } = await loadModule();
    const firstEnv = buildCodexAppServerEnv({});
    const firstHome = firstEnv.CODEX_HOME as string;
    expect(fs.existsSync(path.join(firstHome, "config.toml"))).toBe(true);

    mockResolveCodexUpstream.mockReturnValue({
      tier: "gateway",
      providerName: "",
      baseUrl: "",
      apiKey: "sk-gateway",
      model: "",
    });

    const secondEnv = buildCodexAppServerEnv({});

    expect(secondEnv).not.toHaveProperty("CODEX_HOME");
  });

  it("uses a distinct CODEX_HOME for different non-local upstream configs", async () => {
    const { buildCodexAppServerEnv } = await loadModule();
    const firstEnv = buildCodexAppServerEnv({});

    mockResolveCodexUpstream.mockReturnValue({
      tier: "gateway",
      providerName: "Gateway",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-gateway",
      model: "gateway-model",
    });
    const secondEnv = buildCodexAppServerEnv({});

    expect(secondEnv.CODEX_HOME).not.toBe(firstEnv.CODEX_HOME);
  });

  it("preserves an explicit RUST_LOG value", async () => {
    const { buildCodexAppServerEnv } = await loadModule();

    const env = buildCodexAppServerEnv({ RUST_LOG: "debug" });

    expect(env.RUST_LOG).toBe("debug");
  });

  it("finds a legacy rollout by thread id across Codex homes", async () => {
    const { findCodexRolloutPath } = await loadModule();
    const threadId = "019ef2fd-0640-73f3-9317-8a971ef1ab46";
    const currentHome = path.join(testDataDir, "current-home");
    const legacyHome = path.join(testDataDir, "legacy-home");
    const rolloutPath = path.join(
      legacyHome,
      "sessions",
      "2026",
      "06",
      "23",
      `rollout-2026-06-23T01-38-49-${threadId}.jsonl`,
    );
    fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
    fs.writeFileSync(rolloutPath, "{}\n", "utf-8");

    expect(findCodexRolloutPath(threadId, undefined, [currentHome, legacyHome])).toBe(fs.realpathSync(rolloutPath));
  });

  it("uses a valid preferred rollout and rejects paths outside known session roots", async () => {
    const { findCodexRolloutPath } = await loadModule();
    const threadId = "019ef2fd-0640-73f3-9317-8a971ef1ab46";
    const codexHome = path.join(testDataDir, "known-home");
    const discoveredPath = path.join(codexHome, "sessions", "2026", `rollout-old-${threadId}.jsonl`);
    const preferredPath = path.join(codexHome, "sessions", "2026", `rollout-new-${threadId}.jsonl`);
    const outsidePath = path.join(testDataDir, `rollout-outside-${threadId}.jsonl`);
    const symlinkPath = path.join(codexHome, "sessions", `rollout-link-${threadId}.jsonl`);
    fs.mkdirSync(path.dirname(preferredPath), { recursive: true });
    fs.writeFileSync(discoveredPath, "{}\n", "utf-8");
    fs.writeFileSync(preferredPath, "{}\n", "utf-8");
    fs.writeFileSync(outsidePath, "{}\n", "utf-8");
    fs.symlinkSync(outsidePath, symlinkPath);

    expect(findCodexRolloutPath(threadId, preferredPath, [codexHome])).toBe(fs.realpathSync(preferredPath));
    expect([fs.realpathSync(discoveredPath), fs.realpathSync(preferredPath)]).toContain(
      findCodexRolloutPath(threadId, outsidePath, [codexHome]),
    );
    expect(findCodexRolloutPath(threadId, symlinkPath, [codexHome])).not.toBe(outsidePath);
  });
});
