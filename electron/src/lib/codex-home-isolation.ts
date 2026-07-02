import fs from "fs";
import path from "path";
import { getDataDir } from "./data-dir";
import { CODEX_GATEWAY_ENV_KEY, CODEX_GATEWAY_PROVIDER_ID } from "./codex-upstream";
import { resolveCodexUpstream, type CodexUpstream } from "./upstream-resolver";

export interface CodexHomeIsolationResult {
  codexHome?: string;
  isolated: boolean;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function getIsolatedCodexHome(): string {
  const dir = path.join(getDataDir(), "codex-home");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function buildIsolatedCodexConfig(upstream: CodexUpstream): string | null {
  if (upstream.tier === "local" || !upstream.baseUrl.trim()) return null;

  const providerName =
    upstream.providerName.trim() ||
    (upstream.tier === "default" ? "DPCC API" : "PccAgent Gateway");
  const lines = [
    `model_provider = ${tomlString(CODEX_GATEWAY_PROVIDER_ID)}`,
  ];
  if (upstream.model.trim()) {
    lines.push(`model = ${tomlString(upstream.model.trim())}`);
  }
  lines.push(
    "",
    `[model_providers.${CODEX_GATEWAY_PROVIDER_ID}]`,
    `name = ${tomlString(providerName)}`,
    `base_url = ${tomlString(upstream.baseUrl.trim())}`,
    `env_key = ${tomlString(CODEX_GATEWAY_ENV_KEY)}`,
    `wire_api = "responses"`,
    `requires_openai_auth = false`,
    "",
  );
  return lines.join("\n");
}

export function prepareCodexHomeIsolation(upstream = resolveCodexUpstream()): CodexHomeIsolationResult {
  if (upstream.tier === "local") {
    return { isolated: false };
  }

  const codexHome = getIsolatedCodexHome();
  const config = buildIsolatedCodexConfig(upstream);
  if (config) {
    fs.writeFileSync(path.join(codexHome, "config.toml"), config, "utf-8");
  }
  return { codexHome, isolated: true };
}

export function buildCodexAppServerEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const upstream = resolveCodexUpstream();
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    RUST_LOG: baseEnv.RUST_LOG ?? "warn",
  };

  if (upstream.tier !== "local" && upstream.apiKey.trim()) {
    env[CODEX_GATEWAY_ENV_KEY] = upstream.apiKey.trim();
  }

  const isolation = prepareCodexHomeIsolation(upstream);
  if (isolation.codexHome) {
    env.CODEX_HOME = isolation.codexHome;
  }

  return env;
}
