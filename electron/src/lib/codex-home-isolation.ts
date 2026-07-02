import fs from "fs";
import path from "path";
import crypto from "crypto";
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

function upstreamConfigHash(upstream: CodexUpstream): string {
  const input = JSON.stringify({
    tier: upstream.tier,
    providerName: upstream.providerName.trim(),
    baseUrl: upstream.baseUrl.trim(),
    model: upstream.model.trim(),
  });
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function getIsolatedCodexHome(upstream?: CodexUpstream): string {
  const baseDir = path.join(getDataDir(), "codex-home");
  const dir = upstream ? path.join(baseDir, upstreamConfigHash(upstream)) : baseDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFileAtomic(filePath: string, contents: string): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, contents, "utf-8");
  fs.renameSync(tmpPath, filePath);
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

  const config = buildIsolatedCodexConfig(upstream);
  if (!config) return { isolated: false };

  const codexHome = getIsolatedCodexHome(upstream);
  writeFileAtomic(path.join(codexHome, "config.toml"), config);
  return { codexHome, isolated: true };
}

export function buildCodexAppServerEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const upstream = resolveCodexUpstream();
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    RUST_LOG: baseEnv.RUST_LOG ?? "warn",
  };
  delete env[CODEX_GATEWAY_ENV_KEY];

  if (upstream.tier !== "local" && upstream.apiKey.trim()) {
    env[CODEX_GATEWAY_ENV_KEY] = upstream.apiKey.trim();
  }

  const isolation = prepareCodexHomeIsolation(upstream);
  if (isolation.codexHome) {
    env.CODEX_HOME = isolation.codexHome;
  }

  return env;
}
