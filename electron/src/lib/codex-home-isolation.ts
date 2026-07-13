import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { getDataDir } from "./data-dir";
import { CODEX_GATEWAY_ENV_KEY, CODEX_GATEWAY_PROVIDER_ID } from "./codex-upstream";
import { resolveCodexUpstream, type CodexUpstream } from "./upstream-resolver";

export interface CodexHomeIsolationResult {
  codexHome?: string;
  isolated: boolean;
}

const CODEX_THREAD_ID_RE = /^[a-zA-Z0-9-]{8,128}$/;

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getSessionRoots(codexHomes: string[]): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved) || !fs.existsSync(resolved)) return;
    seen.add(resolved);
    roots.push(resolved);
  };

  for (const home of codexHomes) {
    add(path.join(home, "sessions"));
    try {
      for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
        if (entry.isDirectory()) add(path.join(home, entry.name, "sessions"));
      }
    } catch {
      // A missing or unreadable historical home is simply skipped.
    }
  }
  return roots;
}

function findRolloutInRoot(root: string, filenameSuffix: string): string | undefined {
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const candidate = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          pending.push(candidate);
        } else if (entry.isFile() && entry.name.endsWith(filenameSuffix)) {
          return fs.realpathSync(candidate);
        }
      }
    } catch {
      // Continue searching other known session roots.
    }
  }
  return undefined;
}

/** Return current, historical isolated, and legacy homes in lookup priority order. */
export function getCodexRolloutSearchHomes(currentCodexHome?: string): string[] {
  return Array.from(new Set([
    ...(currentCodexHome ? [currentCodexHome] : []),
    path.join(getDataDir(), "codex-home"),
    ...(process.env.CODEX_HOME ? [process.env.CODEX_HOME] : []),
    path.join(os.homedir(), ".codex"),
  ].map((home) => path.resolve(home))));
}

/** Resolve a persisted rollout without allowing arbitrary paths outside known Codex homes. */
export function findCodexRolloutPath(
  threadId: string,
  preferredPath?: string,
  codexHomes?: string[],
): string | undefined {
  if (!CODEX_THREAD_ID_RE.test(threadId)) return undefined;

  const homes = codexHomes ?? getCodexRolloutSearchHomes();
  const sessionRoots = getSessionRoots(homes);
  const filenameSuffix = `-${threadId}.jsonl`;

  if (
    preferredPath &&
    path.basename(preferredPath).endsWith(filenameSuffix) &&
    fs.existsSync(preferredPath)
  ) {
    try {
      if (
        fs.statSync(preferredPath).isFile() &&
        sessionRoots.some((root) => isPathWithin(root, preferredPath))
      ) return fs.realpathSync(preferredPath);
    } catch {
      // Fall through to thread-id lookup when the persisted path is stale.
    }
  }

  for (const root of sessionRoots) {
    const found = findRolloutInRoot(root, filenameSuffix);
    if (found) return found;
  }
  return undefined;
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
