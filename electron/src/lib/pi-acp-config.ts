import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDataDir } from "./data-dir";
import { fetchUpstreamModels } from "./upstream-models";
import {
  buildPiThinkingLevelMap,
  getModelReasoningProfile,
} from "@shared/lib/model-effort-capabilities";
import {
  PI_DPCC_CLAUDE_PROVIDER_ID,
  PI_DPCC_CODEX_PROVIDER_ID,
  PI_GATEWAY_PROVIDER_ID,
  resolvePiUpstream,
  type PiProviderUpstream,
  type PiUpstream,
} from "./upstream-resolver";
import { type InstalledAgent } from "@shared/types/registry";
import { isProtectedBuiltInPiAgent } from "@shared/lib/session-runtime";
import {
  bundledPiEnvironment,
  resolveBundledPiRuntime,
} from "./bundled-pi-runtime";
import { getPiPackageLaunchResources } from "./pi-package-store";

const PI_DPCC_CLAUDE_ENV_KEY = "PCC_AGENT_PI_DPCC_CLAUDE_KEY";
const PI_DPCC_CODEX_ENV_KEY = "PCC_AGENT_PI_DPCC_CODEX_KEY";
const PI_GATEWAY_ENV_KEY = "PCC_AGENT_PI_GATEWAY_KEY";
const PI_MCP_EXTENSION_ENV_KEY = "PCC_AGENT_PI_MCP_EXTENSION";
const PI_MCP_CONFIG_ENV_KEY = "PCC_AGENT_PI_MCP_CONFIG";
const PI_MCP_ADAPTER_ENV_KEY = "PCC_AGENT_PI_MCP_ADAPTER";
const PI_CONTEXT_EXTENSION_ENV_KEY = "PCC_AGENT_PI_CONTEXT_EXTENSION";
const PI_GLOBAL_SKILLS_ENV_KEY = "PCC_AGENT_PI_GLOBAL_SKILLS";
const PI_PROJECT_SKILLS_ENV_KEY = "PCC_AGENT_PI_PROJECT_SKILLS";
const PI_PACKAGE_BOOTSTRAP_ENV_KEY = "PCC_AGENT_PI_PACKAGE_BOOTSTRAP";
const PI_PACKAGE_CONFIG_ENV_KEY = "PCC_AGENT_PI_PACKAGE_CONFIG";

function piRuntimeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

const PI_PROVIDER_CREDENTIAL_KEYS = new Set([
  "AI_GATEWAY_API_KEY",
  "ANT_LING_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "AZURE_OPENAI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "BASETEN_API_KEY",
  "CEREBRAS_API_KEY",
  "CLOUDFLARE_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "KIMI_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "MISTRAL_API_KEY",
  "MOONSHOT_API_KEY",
  "NVIDIA_API_KEY",
  "OPENAI_API_KEY",
  "OPENCODE_API_KEY",
  "OPENROUTER_API_KEY",
  "QWEN_TOKEN_PLAN_API_KEY",
  "QWEN_TOKEN_PLAN_CN_API_KEY",
  "RADIUS_API_KEY",
  "TOGETHER_API_KEY",
  "XAI_API_KEY",
  "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  "ZAI_API_KEY",
  "ZAI_CODING_CN_API_KEY",
  PI_DPCC_CLAUDE_ENV_KEY,
  PI_DPCC_CODEX_ENV_KEY,
  PI_GATEWAY_ENV_KEY,
]);

const PI_PROVIDER_ROUTING_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "AWS_CONFIG_FILE",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AZURE_OPENAI_BASE_URL",
  "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
  "AZURE_OPENAI_RESOURCE_NAME",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_PROJECT",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  PI_MCP_EXTENSION_ENV_KEY,
  PI_MCP_CONFIG_ENV_KEY,
  PI_MCP_ADAPTER_ENV_KEY,
  PI_CONTEXT_EXTENSION_ENV_KEY,
  PI_GLOBAL_SKILLS_ENV_KEY,
  PI_PROJECT_SKILLS_ENV_KEY,
  PI_PACKAGE_BOOTSTRAP_ENV_KEY,
  PI_PACKAGE_CONFIG_ENV_KEY,
  "PI_CODING_AGENT_DIR",
]);

export interface PiLaunchMcpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  url?: string;
  headers?: Array<{ name: string; value: string }>;
}

export interface PreparePiAcpLaunchOptions {
  cwd?: string;
  mcpServers?: PiLaunchMcpServer[];
}

export interface PiAcpLaunchDefinition {
  binary: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  name: string;
  replaceEnvironment?: boolean;
  adapterVersion?: string;
  piVersion?: string;
  mcpAdapterVersion?: string;
  runtimeSource?: "bundled";
  cleanup?: () => void;
}

interface PiProviderCatalog {
  provider: PiProviderUpstream;
  models: string[];
}

interface PiModelListResult {
  models: string[];
  error: string | null;
}

function providerEnvKey(providerId: string): string {
  switch (providerId) {
    case PI_DPCC_CLAUDE_PROVIDER_ID:
      return PI_DPCC_CLAUDE_ENV_KEY;
    case PI_DPCC_CODEX_PROVIDER_ID:
      return PI_DPCC_CODEX_ENV_KEY;
    case PI_GATEWAY_PROVIDER_ID:
      return PI_GATEWAY_ENV_KEY;
    default:
      throw piRuntimeError("pi_provider_unsupported", `Unsupported Pi provider: ${providerId}`);
  }
}

function qualifyModel(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

function qualifyConfiguredModel(upstream: PiUpstream, model: string): string {
  const value = model.trim();
  if (!value || value.includes("/")) return value;
  return upstream.providers.length === 1
    ? qualifyModel(upstream.providers[0].id, value)
    : value;
}

async function fetchProviderCatalogs(upstream: PiUpstream): Promise<{
  catalogs: PiProviderCatalog[];
  error: string | null;
}> {
  if (upstream.tier === "local") return { catalogs: [], error: "local_provider_unreadable" };
  if (upstream.providers.length === 0) return { catalogs: [], error: "no_endpoint" };
  if (upstream.providers.some((provider) => !provider.apiKey.trim())) {
    return { catalogs: [], error: "no_token" };
  }

  const results = await Promise.all(upstream.providers.map(async (provider) => ({
    provider,
    result: await fetchUpstreamModels(provider.baseUrl, provider.apiKey),
  })));
  const failed = results.find(({ result }) => result.error || result.models.length === 0);
  if (failed) {
    return {
      catalogs: [],
      error: failed.result.error ?? `${failed.provider.id}:empty_catalog`,
    };
  }
  return {
    catalogs: results.map(({ provider, result }) => ({ provider, models: result.models })),
    error: null,
  };
}

/** 抓dpcc上游models */
export async function listPiUpstreamModels(
  upstream = resolvePiUpstream(),
): Promise<PiModelListResult> {
  const { catalogs, error } = await fetchProviderCatalogs(upstream);
  return {
    models: error
      ? []
      : catalogs.flatMap(({ provider, models }) =>
        models.map((modelId) => qualifyModel(provider.id, modelId))),
    error,
  };
}

function gatewayCatalogs(upstream: PiUpstream): PiProviderCatalog[] {
  return upstream.providers.map((provider) => ({
    provider,
    models: Array.from(new Set(provider.models.map((model) => model.trim()).filter(Boolean))),
  }));
}

function cachedPiModel(agent: InstalledAgent): string {
  return agent.cachedConfigOptions
    ?.find((option) => option.id === "model" || option.category === "model")
    ?.currentValue?.trim() ?? "";
}

function selectDefaultModel(
  upstream: PiUpstream,
  catalogs: PiProviderCatalog[],
  preferredModel: string,
): { provider: string; model: string } {
  const available = new Set(catalogs.flatMap(({ provider, models }) =>
    models.map((modelId) => qualifyModel(provider.id, modelId))));
  const candidates = [
    preferredModel.trim(),
    qualifyConfiguredModel(upstream, upstream.model),
    available.values().next().value ?? "",
  ];
  const selected = candidates.find((candidate) => available.has(candidate));
  if (!selected) throw piRuntimeError("pi_model_unavailable", "Pi upstream has no available models.");
  const separator = selected.indexOf("/");
  return {
    provider: selected.slice(0, separator),
    model: selected.slice(separator + 1),
  };
}

function writeFileAtomic(filePath: string, contents: string): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, contents, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows and some managed filesystems do not expose POSIX file modes.
  }
}

function keyValuePairsToRecord(
  values: Array<{ name: string; value: string }> | undefined,
): Record<string, string> {
  return Object.fromEntries((values ?? []).map(({ name, value }) => [name, value]));
}

function buildPiMcpConfig(servers: PiLaunchMcpServer[]): Record<string, unknown> {
  const mcpServers: Record<string, Record<string, unknown>> = Object.create(null) as Record<
    string,
    Record<string, unknown>
  >;
  for (const server of servers) {
    const name = server.name.trim();
    if (!name || Object.prototype.hasOwnProperty.call(mcpServers, name)) {
      throw piRuntimeError("pi_mcp_config_invalid", "Pi MCP server names must be non-empty and unique.");
    }

    const command = server.command?.trim();
    const url = server.url?.trim();
    if (command) {
      const env = keyValuePairsToRecord(server.env);
      mcpServers[name] = {
        command,
        args: server.args ?? [],
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
      continue;
    }
    if (url) {
      const headers = keyValuePairsToRecord(server.headers);
      mcpServers[name] = {
        url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
      continue;
    }
    throw piRuntimeError("pi_mcp_config_invalid", `Pi MCP server "${name}" has no transport.`);
  }

  return {
    settings: {
      sampling: false,
      elicitation: false,
      notifyOnStartupConnect: false,
    },
    mcpServers,
  };
}

function preparePiMcpEnvironment(
  runtime: ReturnType<typeof resolveBundledPiRuntime>,
  options: PreparePiAcpLaunchOptions,
): { env: NodeJS.ProcessEnv; cleanup?: () => void } {
  const servers = options.mcpServers ?? [];
  if (servers.length === 0) {
    return {
      env: {
        [PI_MCP_EXTENSION_ENV_KEY]: "",
        [PI_MCP_CONFIG_ENV_KEY]: "",
        [PI_MCP_ADAPTER_ENV_KEY]: "",
      },
    };
  }
  if (!options.cwd || !path.isAbsolute(options.cwd)) {
    throw piRuntimeError("pi_mcp_config_invalid", "Pi MCP configuration requires an absolute session cwd.");
  }

  const configDirectory = path.join(getDataDir(), "pi-mcp");
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  const configPath = path.join(configDirectory, `${process.pid}-${crypto.randomUUID()}.json`);
  writeFileAtomic(configPath, `${JSON.stringify(buildPiMcpConfig(servers), null, 2)}\n`);

  let cleaned = false;
  return {
    env: {
      [PI_MCP_EXTENSION_ENV_KEY]: runtime.piMcpBridgePath,
      [PI_MCP_CONFIG_ENV_KEY]: configPath,
      [PI_MCP_ADAPTER_ENV_KEY]: runtime.piMcpAdapter.entryPath,
    },
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      fs.rmSync(configPath, { force: true });
    },
  };
}

function combineCleanupCallbacks(
  callbacks: Array<(() => void) | undefined>,
): (() => void) | undefined {
  const activeCallbacks = callbacks.filter((callback): callback is () => void => Boolean(callback));
  if (activeCallbacks.length === 0) return undefined;
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const callback of activeCallbacks) {
      try {
        callback();
      } catch {
        // Best-effort cleanup keeps other per-session artifacts from leaking.
      }
    }
  };
}

async function preparePiPackageEnvironment(
  runtime: ReturnType<typeof resolveBundledPiRuntime>,
): Promise<{ env: NodeJS.ProcessEnv; cleanup?: () => void }> {
  const resources = await getPiPackageLaunchResources();
  const resourceCount = Object.values(resources).reduce((total, paths) => total + paths.length, 0);
  if (resourceCount === 0) {
    return { env: { [PI_PACKAGE_CONFIG_ENV_KEY]: "" } };
  }
  if (!runtime.piPackageBootstrapAvailable) {
    throw piRuntimeError("pi_package_bootstrap_missing", "The bundled Pi package launcher is unavailable.");
  }

  const configDirectory = path.join(getDataDir(), "pi-package-launch");
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  const configPath = path.join(configDirectory, `${process.pid}-${crypto.randomUUID()}.json`);
  writeFileAtomic(configPath, `${JSON.stringify({ version: 1, resources }, null, 2)}\n`);

  let cleaned = false;
  return {
    env: { [PI_PACKAGE_CONFIG_ENV_KEY]: configPath },
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      fs.rmSync(configPath, { force: true });
    },
  };
}

async function preparePiManagedLaunchEnvironment(
  runtime: ReturnType<typeof resolveBundledPiRuntime>,
  options: PreparePiAcpLaunchOptions,
): Promise<{ env: NodeJS.ProcessEnv; cleanup?: () => void }> {
  const mcp = preparePiMcpEnvironment(runtime, options);
  try {
    const packages = await preparePiPackageEnvironment(runtime);
    return {
      env: { ...mcp.env, ...packages.env },
      cleanup: combineCleanupCallbacks([mcp.cleanup, packages.cleanup]),
    };
  } catch (error) {
    mcp.cleanup?.();
    throw error;
  }
}

function preparePiSkillEnvironment(cwd?: string): NodeJS.ProcessEnv {
  const globalSkillsPath = path.join(os.homedir(), ".agents", "skills");
  const projectSkillsPath = cwd && path.isAbsolute(cwd)
    ? path.join(cwd, ".agents", "skills")
    : null;
  const env: NodeJS.ProcessEnv = {
    [PI_GLOBAL_SKILLS_ENV_KEY]: "",
    [PI_PROJECT_SKILLS_ENV_KEY]: "",
  };
  try {
    if (fs.statSync(globalSkillsPath).isDirectory()) {
      env[PI_GLOBAL_SKILLS_ENV_KEY] = globalSkillsPath;
    }
  } catch {
    // No global Skills are installed for this Pi session.
  }
  if (projectSkillsPath) {
    try {
      if (fs.statSync(projectSkillsPath).isDirectory()) {
        env[PI_PROJECT_SKILLS_ENV_KEY] = projectSkillsPath;
      }
    } catch {
      // No project Skills are installed for this Pi session.
    }
  }
  return env;
}

function preparePiAgentDirectory(
  upstream: PiUpstream,
  catalogs: PiProviderCatalog[],
  selected: { provider: string; model: string },
): string {
  const sessionDir = path.join(getDataDir(), "pi-sessions");
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    tier: upstream.tier,
    providers: catalogs.map(({ provider, models }) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      authHeader: provider.authHeader === true,
      models,
    })),
    selected,
  })).digest("hex").slice(0, 16);
  const agentDir = path.join(getDataDir(), "pi-agent", fingerprint);
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

  const providers = Object.fromEntries(catalogs.map(({ provider, models }) => [
    provider.id,
    {
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: `$${providerEnvKey(provider.id)}`,
      ...(provider.authHeader ? { authHeader: true } : {}),
      models: models.map((modelId) => {
        const reasoningProfile = upstream.tier === "default"
          ? getModelReasoningProfile(modelId)
          : undefined;
        const piThinking = reasoningProfile?.piThinking;
        const thinkingLevelMap = reasoningProfile
          ? buildPiThinkingLevelMap(modelId)
          : undefined;
        const compat = piThinking?.forceAdaptiveThinking && provider.api === "anthropic-messages"
          ? { forceAdaptiveThinking: true }
          : reasoningProfile?.effort && provider.api === "openai-completions"
            ? { supportsReasoningEffort: true }
            : undefined;

        return {
          id: modelId,
          name: `${modelId} (${provider.name})`,
          ...(upstream.tier === "default"
            ? {
              reasoning: reasoningProfile ? piThinking !== null : true,
              input: ["text", "image"],
              ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
              ...(compat ? { compat } : {}),
            }
            : {}),
        };
      }),
    },
  ]));
  writeFileAtomic(path.join(agentDir, "models.json"), `${JSON.stringify({ providers }, null, 2)}\n`);
  writeFileAtomic(path.join(agentDir, "settings.json"), `${JSON.stringify({
    defaultProvider: selected.provider,
    defaultModel: selected.model,
    sessionDir,
    quietStartup: true,
  }, null, 2)}\n`);
  fs.rmSync(path.join(agentDir, "auth.json"), { force: true });
  return agentDir;
}

/** Build a child-only environment so local Pi provider credentials cannot leak into managed sources. */
function buildIsolatedPiEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  agentEnv: NodeJS.ProcessEnv | undefined,
  upstream: PiUpstream,
  agentDir: string,
  piCommand: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...agentEnv };
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase();
    if (PI_PROVIDER_CREDENTIAL_KEYS.has(normalized) || PI_PROVIDER_ROUTING_KEYS.has(normalized)) {
      delete env[key];
    }
  }
  env.PI_CODING_AGENT_DIR = agentDir;
  env.PI_ACP_PI_COMMAND = piCommand;
  for (const provider of upstream.providers) {
    env[providerEnvKey(provider.id)] = provider.apiKey;
  }
  return env;
}

export function isOfficialPiAcpAgent(
  agent: Pick<InstalledAgent, "id" | "engine" | "builtIn" | "registryId">,
): boolean {
  return isProtectedBuiltInPiAgent(agent);
}

function e2ePiCommandOverride(): string | undefined {
  if (process.env.HARNSS_E2E_MODE !== "acp-recovery") return undefined;
  const candidate = process.env.PI_ACP_PI_COMMAND?.trim();
  if (!candidate || !path.isAbsolute(candidate)) {
    throw piRuntimeError("pi_e2e_command_invalid", "Pi recovery E2E requires an absolute fixture command.");
  }
  try {
    fs.accessSync(candidate, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
  } catch {
    throw piRuntimeError("pi_e2e_command_invalid", "Pi recovery E2E fixture command is unavailable.");
  }
  return candidate;
}

/** Prepare the protected built-in Pi runtime without consulting PATH or npx. */
export async function preparePiAcpLaunch(
  agent: InstalledAgent,
  options: PreparePiAcpLaunchOptions = {},
): Promise<PiAcpLaunchDefinition> {
  const runtime = resolveBundledPiRuntime();
  const piCommand = e2ePiCommandOverride() ?? runtime.piCommandPath;
  const runtimeEnv = bundledPiEnvironment(runtime, piCommand);
  const contextEnv: NodeJS.ProcessEnv = {
    [PI_CONTEXT_EXTENSION_ENV_KEY]: runtime.piContextExtensionPath,
    [PI_PACKAGE_BOOTSTRAP_ENV_KEY]: runtime.piPackageBootstrapPath,
    [PI_PACKAGE_CONFIG_ENV_KEY]: "",
  };
  const skillEnv = preparePiSkillEnvironment(options.cwd);

  const upstream = resolvePiUpstream();
  const baseLaunch = {
    binary: runtime.hostPath,
    args: [runtime.piAcp.entryPath],
    name: agent.name,
    adapterVersion: runtime.piAcp.actualVersion ?? agent.registryVersion,
    piVersion: runtime.pi.actualVersion ?? undefined,
    mcpAdapterVersion: runtime.piMcpAdapter.actualVersion ?? undefined,
    runtimeSource: "bundled" as const,
  };
  if (upstream.tier === "local") {
    const managed = await preparePiManagedLaunchEnvironment(runtime, options);
    return {
      ...baseLaunch,
      env: { ...agent.env, ...runtimeEnv, ...contextEnv, ...skillEnv, ...managed.env },
      cleanup: managed.cleanup,
    };
  }
  //如果dpcc上游没有返回url和key
  if (upstream.providers.some((provider) => !provider.baseUrl.trim() || !provider.apiKey.trim())) {
    throw piRuntimeError(
      "pi_config_incomplete",
      `Pi ${upstream.tier === "default" ? "DPCC" : "gateway"} configuration is incomplete.`,
    );
  }

  const catalogResult = upstream.tier === "default"
    ? await fetchProviderCatalogs(upstream)
    : { catalogs: gatewayCatalogs(upstream), error: null };
  if (catalogResult.error) {
    throw piRuntimeError(
      "pi_catalog_unavailable",
      `Pi ${upstream.tier === "default" ? "DPCC" : "gateway"} model catalog is unavailable: ${catalogResult.error}`,
    );
  }
  if (catalogResult.catalogs.some(({ models }) => models.length === 0)) {
    throw piRuntimeError("pi_catalog_missing", "Pi gateway has no configured models.");
  }

  const selected = selectDefaultModel(upstream, catalogResult.catalogs, cachedPiModel(agent));
  const agentDir = preparePiAgentDirectory(upstream, catalogResult.catalogs, selected);
  const managed = await preparePiManagedLaunchEnvironment(runtime, options);
  return {
    ...baseLaunch,
    env: {
      ...buildIsolatedPiEnvironment(
        process.env,
        { ...agent.env, ...runtimeEnv },
        upstream,
        agentDir,
        piCommand,
      ),
      ...contextEnv,
      ...skillEnv,
      ...managed.env,
    },
    replaceEnvironment: true,
    cleanup: managed.cleanup,
  };
}
