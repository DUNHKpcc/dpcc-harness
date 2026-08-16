import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
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
import type { InstalledAgent } from "@shared/types/registry";

const execFileAsync = promisify(execFile);

const PI_ACP_REGISTRY_ID = "pi-acp";
const PI_DPCC_CLAUDE_ENV_KEY = "PCC_AGENT_PI_DPCC_CLAUDE_KEY";
const PI_DPCC_CODEX_ENV_KEY = "PCC_AGENT_PI_DPCC_CODEX_KEY";
const PI_GATEWAY_ENV_KEY = "PCC_AGENT_PI_GATEWAY_KEY";

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
  "PI_CODING_AGENT_DIR",
]);

interface PiAcpLaunchDefinition {
  binary: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  name: string;
  replaceEnvironment?: boolean;
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
      throw new Error(`Unsupported Pi provider: ${providerId}`);
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

/** Live model list used by Current Config. DPCC succeeds only when both key catalogs succeed. */
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
  if (!selected) throw new Error("Pi upstream has no available models.");
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
  agentEnv: Record<string, string> | undefined,
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

function stripQuotes(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function resolveExecutable(command: string): Promise<string | null> {
  const candidate = stripQuotes(command);
  if (!candidate) return null;
  if (path.isAbsolute(candidate) || /[\\/]/.test(candidate)) {
    try {
      fs.accessSync(candidate, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(candidate)) return null;

  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(locator, [candidate]);
    const found = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (found) return found;
  } catch {
    // GUI-launched apps may not inherit the user's login-shell PATH.
  }

  if (process.platform !== "win32") {
    const shell = process.env.SHELL?.trim() || "/bin/zsh";
    try {
      const { stdout } = await execFileAsync(shell, ["-lc", `command -v ${quotePosixArg(candidate)}`]);
      return stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => path.isAbsolute(line)) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export function isOfficialPiAcpAgent(agent: Pick<InstalledAgent, "engine" | "registryId">): boolean {
  return agent.engine === "acp" && agent.registryId?.trim() === PI_ACP_REGISTRY_ID;
}

function adapterCommand(agent: InstalledAgent): { command: string; args?: string[] } {
  const usesRegistryNpx = agent.binary?.trim().toLowerCase() === "npx"
    && /^pi-acp(?:@|$)/i.test(agent.args?.[0]?.trim() ?? "");
  return usesRegistryNpx
    ? { command: "pi-acp", args: agent.args?.slice(1) }
    : { command: agent.binary?.trim() ?? "", args: agent.args };
}

/** Prepare only the official Pi ACP adapter. Installation remains entirely user-managed. */
export async function preparePiAcpLaunch(agent: InstalledAgent): Promise<PiAcpLaunchDefinition> {
  const adapter = adapterCommand(agent);
  const resolvedAdapter = await resolveExecutable(adapter.command);
  if (!resolvedAdapter) {
    throw new Error("Pi ACP adapter was not found. Install pi-acp and ensure the pi-acp command is available on PATH.");
  }
  const configuredPiCommand = agent.env?.PI_ACP_PI_COMMAND || process.env.PI_ACP_PI_COMMAND || "pi";
  const resolvedPiCommand = await resolveExecutable(configuredPiCommand);
  if (!resolvedPiCommand) {
    throw new Error("Pi CLI was not found. Install @earendil-works/pi-coding-agent and ensure the pi command is available on PATH.");
  }

  const upstream = resolvePiUpstream();
  if (upstream.tier === "local") {
    return {
      binary: resolvedAdapter,
      args: adapter.args,
      env: { ...agent.env, PI_ACP_PI_COMMAND: resolvedPiCommand },
      name: agent.name,
    };
  }

  if (upstream.providers.some((provider) => !provider.baseUrl.trim() || !provider.apiKey.trim())) {
    throw new Error(`Pi ${upstream.tier === "default" ? "DPCC" : "gateway"} configuration is incomplete.`);
  }

  const catalogResult = upstream.tier === "default"
    ? await fetchProviderCatalogs(upstream)
    : { catalogs: gatewayCatalogs(upstream), error: null };
  if (catalogResult.error) {
    throw new Error(`Pi ${upstream.tier === "default" ? "DPCC" : "gateway"} model catalog is unavailable: ${catalogResult.error}`);
  }
  if (catalogResult.catalogs.some(({ models }) => models.length === 0)) {
    throw new Error("Pi gateway has no configured models.");
  }

  const selected = selectDefaultModel(upstream, catalogResult.catalogs, cachedPiModel(agent));
  const agentDir = preparePiAgentDirectory(upstream, catalogResult.catalogs, selected);
  return {
    binary: resolvedAdapter,
    args: adapter.args,
    env: buildIsolatedPiEnvironment(process.env, agent.env, upstream, agentDir, resolvedPiCommand),
    name: agent.name,
    replaceEnvironment: true,
  };
}
