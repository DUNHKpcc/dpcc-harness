import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledAgent } from "@shared/types/registry";
import type { PiUpstream } from "./upstream-resolver";

const {
  dataDirRef,
  mockBundledPiEnvironment,
  mockFetchUpstreamModels,
  mockGetPiPackageLaunchResources,
  mockResolveBundledPiRuntime,
  mockResolvePiUpstream,
} = vi.hoisted(() => ({
  dataDirRef: { current: "" },
  mockBundledPiEnvironment: vi.fn(),
  mockFetchUpstreamModels: vi.fn(),
  mockGetPiPackageLaunchResources: vi.fn(),
  mockResolveBundledPiRuntime: vi.fn(),
  mockResolvePiUpstream: vi.fn(),
}));

const BUNDLED_HOST = "/embedded/PccAgent";
const BUNDLED_PI_COMMAND = "/embedded/resources/pi-runtime/bin/pi";
const BUNDLED_PI_ENTRY = "/embedded/app.asar/node_modules/pi/dist/cli.js";
const BUNDLED_PI_ACP_ENTRY = "/embedded/app.asar/node_modules/pi-acp/dist/index.js";
const BUNDLED_PI_MCP_ENTRY = "/embedded/app.asar/node_modules/pi-mcp-adapter/index.ts";
const BUNDLED_PI_MCP_BRIDGE = "/embedded/resources/pi-runtime/extensions/pcc-mcp.ts";
const BUNDLED_PI_CONTEXT_BRIDGE = "/embedded/resources/pi-runtime/extensions/pcc-context-usage.ts";
const BUNDLED_PI_PACKAGE_BOOTSTRAP = "/embedded/resources/pi-runtime/bin/pcc-pi-package-launch.cjs";

vi.mock("./data-dir", () => ({
  getDataDir: () => dataDirRef.current,
}));

vi.mock("./upstream-models", () => ({
  fetchUpstreamModels: mockFetchUpstreamModels,
}));

vi.mock("./upstream-resolver", () => ({
  PI_DPCC_CLAUDE_PROVIDER_ID: "pcc-agent-dpcc-claude",
  PI_DPCC_CODEX_PROVIDER_ID: "pcc-agent-dpcc-codex",
  PI_GATEWAY_PROVIDER_ID: "pcc-agent-gateway",
  resolvePiUpstream: mockResolvePiUpstream,
}));

vi.mock("./bundled-pi-runtime", () => ({
  resolveBundledPiRuntime: mockResolveBundledPiRuntime,
  bundledPiEnvironment: mockBundledPiEnvironment,
}));

vi.mock("./pi-package-store", () => ({
  getPiPackageLaunchResources: mockGetPiPackageLaunchResources,
}));

async function loadModule() {
  vi.resetModules();
  return import("./pi-acp-config");
}

function dpccUpstream(): PiUpstream {
  return {
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
    model: "",
  };
}

function executable(name: string): string {
  const filePath = path.join(dataDirRef.current, name);
  fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return filePath;
}

function piAgent(adapterPath: string, piPath: string): InstalledAgent {
  return {
    id: "pi-acp",
    name: "Pi",
    engine: "acp",
    binary: adapterPath,
    args: ["--test-arg"],
    env: {
      PI_ACP_PI_COMMAND: piPath,
      OPENAI_API_KEY: "sk-local-openai",
      ANTHROPIC_AUTH_TOKEN: "sk-local-anthropic",
      AWS_PROFILE: "local-profile",
      QWEN_TOKEN_PLAN_API_KEY: "sk-local-qwen",
      PCC_AGENT_PI_MCP_EXTENSION: "/tmp/ambient-extension.ts",
      PCC_AGENT_PI_MCP_CONFIG: "/tmp/ambient-mcp.json",
      PCC_AGENT_PI_MCP_ADAPTER: "/tmp/ambient-adapter.ts",
      PCC_AGENT_PI_CONTEXT_EXTENSION: "/tmp/ambient-context.ts",
      PCC_AGENT_PI_GLOBAL_SKILLS: "/tmp/ambient-skills",
      PCC_AGENT_PI_PACKAGE_BOOTSTRAP: "/tmp/ambient-package-launch.cjs",
      PCC_AGENT_PI_PACKAGE_CONFIG: "/tmp/ambient-package-config.json",
      KEEP_ME: "yes",
    },
    registryId: "pi-acp",
    cachedConfigOptions: [{
      id: "model",
      name: "Model",
      type: "select",
      currentValue: "pcc-agent-dpcc-codex/shared-model",
      options: [],
    }],
  };
}

describe("Pi ACP config", () => {
  let homeDirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dataDirRef.current = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-agent-pi-"));
    homeDirSpy = vi.spyOn(os, "homedir").mockReturnValue(path.join(dataDirRef.current, "home"));
    mockFetchUpstreamModels.mockReset();
    mockGetPiPackageLaunchResources.mockReset();
    mockResolvePiUpstream.mockReset();
    mockResolveBundledPiRuntime.mockReset();
    mockBundledPiEnvironment.mockReset();
    mockGetPiPackageLaunchResources.mockReturnValue({
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    });
    mockResolveBundledPiRuntime.mockReturnValue({
      source: "bundled",
      isPackaged: true,
      hostPath: BUNDLED_HOST,
      hostAvailable: true,
      piCommandPath: BUNDLED_PI_COMMAND,
      piCommandAvailable: true,
      piMcpBridgePath: BUNDLED_PI_MCP_BRIDGE,
      piMcpBridgeAvailable: true,
      piContextExtensionPath: BUNDLED_PI_CONTEXT_BRIDGE,
      piContextExtensionAvailable: true,
      piPackageBootstrapPath: BUNDLED_PI_PACKAGE_BOOTSTRAP,
      piPackageBootstrapAvailable: true,
      pi: {
        packageName: "@earendil-works/pi-coding-agent",
        expectedVersion: "0.84.1",
        actualVersion: "0.84.1",
        packageRoot: "/embedded/app.asar/node_modules/pi",
        entryPath: BUNDLED_PI_ENTRY,
        available: true,
        code: null,
      },
      piAcp: {
        packageName: "pi-acp",
        expectedVersion: "0.0.33",
        actualVersion: "0.0.33",
        packageRoot: "/embedded/app.asar/node_modules/pi-acp",
        entryPath: BUNDLED_PI_ACP_ENTRY,
        available: true,
        code: null,
      },
      piMcpAdapter: {
        packageName: "pi-mcp-adapter",
        expectedVersion: "2.31.0",
        actualVersion: "2.31.0",
        packageRoot: "/embedded/app.asar/node_modules/pi-mcp-adapter",
        entryPath: BUNDLED_PI_MCP_ENTRY,
        available: true,
        code: null,
      },
      offlineReady: true,
    });
    mockBundledPiEnvironment.mockImplementation((_runtime, piCommand = BUNDLED_PI_COMMAND) => ({
      ELECTRON_RUN_AS_NODE: "1",
      PCC_AGENT_PI_RUNTIME_HOST: BUNDLED_HOST,
      PCC_AGENT_PI_ENTRY: BUNDLED_PI_ENTRY,
      PI_ACP_PI_COMMAND: piCommand,
      PCC_AGENT_PI_CONTEXT_EXTENSION: BUNDLED_PI_CONTEXT_BRIDGE,
      PCC_AGENT_PI_PACKAGE_BOOTSTRAP: BUNDLED_PI_PACKAGE_BOOTSTRAP,
      PCC_AGENT_PI_PACKAGE_CONFIG: "",
    }));
    mockResolvePiUpstream.mockReturnValue(dpccUpstream());
    mockFetchUpstreamModels.mockImplementation(async (_baseUrl: string, token: string) => ({
      models: token.endsWith("claude")
        ? ["shared-model", "claude-model"]
        : ["shared-model", "codex-model"],
      error: null,
    }));
  });

  afterEach(() => {
    homeDirSpy.mockRestore();
    fs.rmSync(dataDirRef.current, { recursive: true, force: true });
  });

  it("recognizes only the registry-backed official Pi ACP agent", async () => {
    const { isOfficialPiAcpAgent } = await loadModule();

    expect(isOfficialPiAcpAgent({
      id: "pi-acp",
      engine: "acp",
      builtIn: true,
      registryId: "pi-acp",
    })).toBe(true);
    expect(isOfficialPiAcpAgent({
      id: "system-pi",
      engine: "acp",
      builtIn: false,
      registryId: "pi-acp",
    })).toBe(false);
    expect(isOfficialPiAcpAgent({
      id: "pi-acp",
      engine: "claude",
      builtIn: true,
      registryId: "pi-acp",
    })).toBe(false);
  });

  it("lists both DPCC catalogs with provider-qualified model ids", async () => {
    const { listPiUpstreamModels } = await loadModule();

    await expect(listPiUpstreamModels(dpccUpstream())).resolves.toEqual({
      models: [
        "pcc-agent-dpcc-claude/shared-model",
        "pcc-agent-dpcc-claude/claude-model",
        "pcc-agent-dpcc-codex/shared-model",
        "pcc-agent-dpcc-codex/codex-model",
      ],
      error: null,
    });
    expect(mockFetchUpstreamModels).toHaveBeenCalledTimes(2);
    expect(mockFetchUpstreamModels).toHaveBeenCalledWith(
      "https://api.dpcc.example",
      "sk-dpcc-claude",
    );
    expect(mockFetchUpstreamModels).toHaveBeenCalledWith(
      "https://api.dpcc.example/v1",
      "sk-dpcc-codex",
    );
  });

  it("fails closed when either DPCC key catalog is unavailable", async () => {
    mockFetchUpstreamModels.mockImplementation(async (_baseUrl: string, token: string) =>
      token.endsWith("codex")
        ? { models: [], error: "401 Unauthorized" }
        : { models: ["claude-model"], error: null });
    const { listPiUpstreamModels } = await loadModule();

    await expect(listPiUpstreamModels(dpccUpstream())).resolves.toEqual({
      models: [],
      error: "401 Unauthorized",
    });
  });

  it("refuses DPCC launch when either required key is missing", async () => {
    const upstream = dpccUpstream();
    upstream.providers[1].apiKey = "";
    mockResolvePiUpstream.mockReturnValue(upstream);
    const adapterPath = executable("pi-acp");
    const piPath = executable("pi");
    const { preparePiAcpLaunch } = await loadModule();

    await expect(preparePiAcpLaunch(piAgent(adapterPath, piPath))).rejects.toMatchObject({
      code: "pi_config_incomplete",
      message: "Pi DPCC configuration is incomplete.",
    });
    expect(mockFetchUpstreamModels).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dataDirRef.current, "pi-agent"))).toBe(false);
  });

  it("propagates a stable bundled runtime failure before reading agent paths", async () => {
    mockResolveBundledPiRuntime.mockImplementation(() => {
      throw Object.assign(new Error("Bundled Pi is missing."), {
        code: "pi_bundled_package_missing",
      });
    });
    const { preparePiAcpLaunch } = await loadModule();

    await expect(preparePiAcpLaunch(piAgent("system-pi-acp", "system-pi"))).rejects.toMatchObject({
      code: "pi_bundled_package_missing",
    });
  });

  it("writes an isolated managed config without persisting either DPCC key", async () => {
    const adapterPath = executable("pi-acp");
    const piPath = executable("pi");
    const { preparePiAcpLaunch } = await loadModule();

    const launch = await preparePiAcpLaunch(piAgent(adapterPath, piPath));

    expect(launch).toMatchObject({
      binary: BUNDLED_HOST,
      args: [BUNDLED_PI_ACP_ENTRY],
      replaceEnvironment: true,
      runtimeSource: "bundled",
      adapterVersion: "0.0.33",
      piVersion: "0.84.1",
      mcpAdapterVersion: "2.31.0",
    });
    expect(launch.env).toMatchObject({
      PCC_AGENT_PI_DPCC_CLAUDE_KEY: "sk-dpcc-claude",
      PCC_AGENT_PI_DPCC_CODEX_KEY: "sk-dpcc-codex",
      PI_ACP_PI_COMMAND: BUNDLED_PI_COMMAND,
      ELECTRON_RUN_AS_NODE: "1",
      PCC_AGENT_PI_RUNTIME_HOST: BUNDLED_HOST,
      PCC_AGENT_PI_ENTRY: BUNDLED_PI_ENTRY,
      KEEP_ME: "yes",
      PCC_AGENT_PI_MCP_EXTENSION: "",
      PCC_AGENT_PI_MCP_CONFIG: "",
      PCC_AGENT_PI_MCP_ADAPTER: "",
      PCC_AGENT_PI_CONTEXT_EXTENSION: BUNDLED_PI_CONTEXT_BRIDGE,
      PCC_AGENT_PI_GLOBAL_SKILLS: "",
      PCC_AGENT_PI_PACKAGE_BOOTSTRAP: BUNDLED_PI_PACKAGE_BOOTSTRAP,
      PCC_AGENT_PI_PACKAGE_CONFIG: "",
    });
    expect(launch.env?.OPENAI_API_KEY).toBeUndefined();
    expect(launch.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(launch.env?.AWS_PROFILE).toBeUndefined();
    expect(launch.env?.QWEN_TOKEN_PLAN_API_KEY).toBeUndefined();

    const agentDir = launch.env?.PI_CODING_AGENT_DIR;
    expect(agentDir).toContain(path.join(dataDirRef.current, "pi-agent"));
    const modelsText = fs.readFileSync(path.join(agentDir!, "models.json"), "utf-8");
    const modelsConfig = JSON.parse(modelsText) as {
      providers: Record<string, { models: Array<{ reasoning?: boolean; input?: string[] }> }>;
    };
    const settings = JSON.parse(fs.readFileSync(path.join(agentDir!, "settings.json"), "utf-8")) as {
      defaultProvider: string;
      defaultModel: string;
      sessionDir: string;
    };
    expect(modelsText).toContain("$PCC_AGENT_PI_DPCC_CLAUDE_KEY");
    expect(modelsText).toContain("$PCC_AGENT_PI_DPCC_CODEX_KEY");
    expect(modelsText).not.toContain("sk-dpcc-claude");
    expect(modelsText).not.toContain("sk-dpcc-codex");
    expect(modelsConfig.providers["pcc-agent-dpcc-claude"].models[0]).toMatchObject({
      reasoning: true,
      input: ["text", "image"],
    });
    expect(modelsConfig.providers["pcc-agent-dpcc-codex"].models[0]).toMatchObject({
      reasoning: true,
      input: ["text", "image"],
    });
    expect(settings).toMatchObject({
      defaultProvider: "pcc-agent-dpcc-codex",
      defaultModel: "shared-model",
      sessionDir: path.join(dataDirRef.current, "pi-sessions"),
    });
    expect(fs.existsSync(path.join(agentDir!, "auth.json"))).toBe(false);
  });

  it("writes documented per-model thinking capabilities into the managed Pi catalog", async () => {
    mockFetchUpstreamModels.mockImplementation(async (_baseUrl: string, token: string) => ({
      models: token.endsWith("claude")
        ? ["claude-opus-4-7", "glm-5.2", "kimi-k2.6"]
        : ["gpt-5.6-sol", "gpt-image-2"],
      error: null,
    }));
    const adapterPath = executable("pi-acp");
    const piPath = executable("pi");
    const { preparePiAcpLaunch } = await loadModule();

    const launch = await preparePiAcpLaunch(piAgent(adapterPath, piPath));
    const agentDir = launch.env?.PI_CODING_AGENT_DIR;
    const modelsConfig = JSON.parse(
      fs.readFileSync(path.join(agentDir!, "models.json"), "utf-8"),
    ) as {
      providers: Record<string, {
        models: Array<{
          id: string;
          reasoning?: boolean;
          thinkingLevelMap?: Record<string, string | null>;
          compat?: Record<string, boolean>;
        }>;
      }>;
    };
    const claudeModels = new Map(
      modelsConfig.providers["pcc-agent-dpcc-claude"].models.map((model) => [model.id, model]),
    );
    const codexModels = new Map(
      modelsConfig.providers["pcc-agent-dpcc-codex"].models.map((model) => [model.id, model]),
    );

    expect(claudeModels.get("claude-opus-4-7")).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" },
      compat: { forceAdaptiveThinking: true },
    });
    expect(claudeModels.get("glm-5.2")).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { low: null, medium: null, xhigh: "max", max: null },
      compat: { forceAdaptiveThinking: true },
    });
    expect(claudeModels.get("kimi-k2.6")).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { low: null, medium: null, xhigh: null, max: null },
    });
    expect(claudeModels.get("kimi-k2.6")?.compat).toBeUndefined();
    expect(codexModels.get("gpt-5.6-sol")).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" },
      compat: { supportsReasoningEffort: true },
    });
    expect(codexModels.get("gpt-image-2")).toMatchObject({
      reasoning: false,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: null,
        xhigh: null,
        max: null,
      },
    });
    expect(codexModels.get("gpt-image-2")?.compat).toBeUndefined();
  });

  it("leaves the user's Pi config and provider environment alone in local mode", async () => {
    mockResolvePiUpstream.mockReturnValue({ tier: "local", providers: [], model: "" });
    const adapterPath = executable("pi-acp");
    const piPath = executable("pi");
    const { preparePiAcpLaunch } = await loadModule();

    const launch = await preparePiAcpLaunch(piAgent(adapterPath, piPath));

    expect(launch.replaceEnvironment).toBeUndefined();
    expect(launch).toMatchObject({
      binary: BUNDLED_HOST,
      args: [BUNDLED_PI_ACP_ENTRY],
      runtimeSource: "bundled",
    });
    expect(launch.env).toMatchObject({
      PI_ACP_PI_COMMAND: BUNDLED_PI_COMMAND,
      ELECTRON_RUN_AS_NODE: "1",
      OPENAI_API_KEY: "sk-local-openai",
      ANTHROPIC_AUTH_TOKEN: "sk-local-anthropic",
      AWS_PROFILE: "local-profile",
      QWEN_TOKEN_PLAN_API_KEY: "sk-local-qwen",
      KEEP_ME: "yes",
      PCC_AGENT_PI_MCP_EXTENSION: "",
      PCC_AGENT_PI_MCP_CONFIG: "",
      PCC_AGENT_PI_MCP_ADAPTER: "",
      PCC_AGENT_PI_CONTEXT_EXTENSION: BUNDLED_PI_CONTEXT_BRIDGE,
      PCC_AGENT_PI_GLOBAL_SKILLS: "",
      PCC_AGENT_PI_PACKAGE_BOOTSTRAP: BUNDLED_PI_PACKAGE_BOOTSTRAP,
      PCC_AGENT_PI_PACKAGE_CONFIG: "",
    });
    expect(fs.existsSync(path.join(dataDirRef.current, "pi-agent"))).toBe(false);
    expect(mockFetchUpstreamModels).not.toHaveBeenCalled();
  });

  it("injects an isolated Pi MCP adapter config and removes it when the ACP process exits", async () => {
    mockResolvePiUpstream.mockReturnValue({ tier: "local", providers: [], model: "" });
    const workspace = path.join(dataDirRef.current, "workspace");
    fs.mkdirSync(workspace);
    const { preparePiAcpLaunch } = await loadModule();

    const launch = await preparePiAcpLaunch(piAgent("ignored-pi-acp", "ignored-pi"), {
      cwd: workspace,
      mcpServers: [
        {
          name: "local-tools",
          command: "node",
          args: ["server.mjs"],
          env: [{ name: "LOCAL_TOKEN", value: "stdio-secret" }],
        },
        {
          name: "remote-tools",
          url: "https://mcp.example.test/mcp",
          headers: [{ name: "Authorization", value: "Bearer remote-secret" }],
        },
      ],
    });

    expect(launch.env).toMatchObject({
      PCC_AGENT_PI_MCP_EXTENSION: BUNDLED_PI_MCP_BRIDGE,
      PCC_AGENT_PI_MCP_ADAPTER: BUNDLED_PI_MCP_ENTRY,
    });
    const configPath = launch.env?.PCC_AGENT_PI_MCP_CONFIG;
    expect(configPath).toContain(path.join(dataDirRef.current, "pi-mcp"));
    const config = JSON.parse(fs.readFileSync(configPath!, "utf8"));
    expect(config).toEqual({
      settings: {
        sampling: false,
        elicitation: false,
        notifyOnStartupConnect: false,
      },
      mcpServers: {
        "local-tools": {
          command: "node",
          args: ["server.mjs"],
          env: { LOCAL_TOKEN: "stdio-secret" },
        },
        "remote-tools": {
          url: "https://mcp.example.test/mcp",
          headers: { Authorization: "Bearer remote-secret" },
        },
      },
    });
    if (process.platform !== "win32") {
      expect(fs.statSync(configPath!).mode & 0o077).toBe(0);
    }

    launch.cleanup?.();
    expect(fs.existsSync(configPath!)).toBe(false);
  });

  it("injects managed Pi package resources through a disposable launch config", async () => {
    mockResolvePiUpstream.mockReturnValue({ tier: "local", providers: [], model: "" });
    mockGetPiPackageLaunchResources.mockReturnValue({
      extensions: ["/managed/pi-package/extensions/fixture.ts"],
      skills: ["/managed/pi-package/skills/fixture/SKILL.md"],
      prompts: ["/managed/pi-package/prompts/fixture.md"],
      themes: ["/managed/pi-package/themes/fixture.json"],
    });
    const { preparePiAcpLaunch } = await loadModule();

    const launch = await preparePiAcpLaunch(piAgent("ignored-pi-acp", "ignored-pi"));

    expect(launch.env).toMatchObject({
      PCC_AGENT_PI_PACKAGE_BOOTSTRAP: BUNDLED_PI_PACKAGE_BOOTSTRAP,
    });
    const configPath = launch.env?.PCC_AGENT_PI_PACKAGE_CONFIG;
    expect(configPath).toContain(path.join(dataDirRef.current, "pi-package-launch"));
    expect(JSON.parse(fs.readFileSync(configPath!, "utf8"))).toEqual({
      version: 1,
      resources: {
        extensions: ["/managed/pi-package/extensions/fixture.ts"],
        skills: ["/managed/pi-package/skills/fixture/SKILL.md"],
        prompts: ["/managed/pi-package/prompts/fixture.md"],
        themes: ["/managed/pi-package/themes/fixture.json"],
      },
    });
    if (process.platform !== "win32") {
      expect(fs.statSync(configPath!).mode & 0o077).toBe(0);
    }

    launch.cleanup?.();
    expect(fs.existsSync(configPath!)).toBe(false);
  });

  it("passes managed global and project Skill roots without approving project resources", async () => {
    mockResolvePiUpstream.mockReturnValue({ tier: "local", providers: [], model: "" });
    const workspace = path.join(dataDirRef.current, "workspace");
    const globalSkillsPath = path.join(os.homedir(), ".agents", "skills");
    const projectSkillsPath = path.join(workspace, ".agents", "skills");
    fs.mkdirSync(path.join(globalSkillsPath, "fixture-skill"), { recursive: true });
    fs.mkdirSync(path.join(projectSkillsPath, "project-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(globalSkillsPath, "fixture-skill", "SKILL.md"),
      "---\nname: fixture-skill\ndescription: fixture\n---\n",
    );
    const { preparePiAcpLaunch } = await loadModule();

    const launch = await preparePiAcpLaunch(piAgent("ignored-pi-acp", "ignored-pi"), {
      cwd: workspace,
    });

    expect(launch.env?.PCC_AGENT_PI_GLOBAL_SKILLS).toBe(globalSkillsPath);
    expect(launch.env?.PCC_AGENT_PI_PROJECT_SKILLS).toBe(projectSkillsPath);
    expect(launch.args).toEqual([BUNDLED_PI_ACP_ENTRY]);
    expect(launch.args).not.toContain("--approve");
  });

  it("injects only the Pi gateway key for a third-party source", async () => {
    mockResolvePiUpstream.mockReturnValue({
      tier: "gateway",
      providers: [{
        id: "pcc-agent-gateway",
        name: "Pi Gateway",
        baseUrl: "https://gateway.example/v1",
        apiKey: "sk-pi-gateway",
        api: "openai-completions",
        models: ["gateway-model"],
      }],
      model: "pcc-agent-gateway/gateway-model",
    });
    const adapterPath = executable("pi-acp");
    const piPath = executable("pi");
    const { preparePiAcpLaunch } = await loadModule();

    const launch = await preparePiAcpLaunch(piAgent(adapterPath, piPath));

    expect(launch.env).toMatchObject({
      PCC_AGENT_PI_GATEWAY_KEY: "sk-pi-gateway",
    });
    expect(launch.env?.PCC_AGENT_PI_DPCC_CLAUDE_KEY).toBeUndefined();
    expect(launch.env?.PCC_AGENT_PI_DPCC_CODEX_KEY).toBeUndefined();
    expect(mockFetchUpstreamModels).not.toHaveBeenCalled();
  });
});
