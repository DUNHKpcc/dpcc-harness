/**
 * Lightweight probes for the user's local Claude Code / Codex CLI configuration.
 *
 * Goal: inspect config files for diagnostics and utility contexts. Session
 * routing itself is resolved in upstream-resolver and uses DPCC by default unless
 * the user explicitly enables an in-app third-party gateway.
 *
 * These probes do not parse the full config — they only detect whether the
 * fields that would conflict with PccAgent's gateway injection are present.
 */

import fs from "fs";
import os from "os";
import path from "path";

export interface LocalClaudeGatewayProbe {
  hasBaseUrl: boolean;
  hasAuthToken: boolean;
  hasApiKey: boolean;
  hasModel: boolean;
}

export interface LocalCodexGatewayProbe {
  /** A custom `model_provider` is set at the root of config.toml */
  hasModelProvider: boolean;
  /** A `[model_providers.X]` table is defined with a non-empty base_url */
  hasCustomProviderBaseUrl: boolean;
  /** A `model = "..."` is set at the root */
  hasModel: boolean;
}

const EMPTY_CLAUDE_PROBE: LocalClaudeGatewayProbe = {
  hasBaseUrl: false,
  hasAuthToken: false,
  hasApiKey: false,
  hasModel: false,
};

const EMPTY_CODEX_PROBE: LocalCodexGatewayProbe = {
  hasModelProvider: false,
  hasCustomProviderBaseUrl: false,
  hasModel: false,
};

function readFileSilent(filePath: string, maxBytes = 524_288): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const fd = fs.openSync(filePath, "r");
    try {
      const stat = fs.fstatSync(fd);
      const size = Math.min(stat.size, maxBytes);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 0);
      return buf.toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function probeLocalClaudeGateway(): LocalClaudeGatewayProbe {
  const raw = readFileSilent(path.join(os.homedir(), ".claude", "settings.json"));
  if (!raw) return EMPTY_CLAUDE_PROBE;
  try {
    const parsed = JSON.parse(raw);
    const env = parsed?.env;
    if (!env || typeof env !== "object" || Array.isArray(env)) return EMPTY_CLAUDE_PROBE;
    const get = (key: string): boolean => {
      const v = (env as Record<string, unknown>)[key];
      return typeof v === "string" && v.trim().length > 0;
    };
    return {
      hasBaseUrl: get("ANTHROPIC_BASE_URL"),
      hasAuthToken: get("ANTHROPIC_AUTH_TOKEN"),
      hasApiKey: get("ANTHROPIC_API_KEY"),
      hasModel: get("ANTHROPIC_MODEL"),
    };
  } catch {
    return EMPTY_CLAUDE_PROBE;
  }
}

/**
 * Tiny TOML scanner sufficient for detecting Codex's gateway-shaped overrides.
 * Walks line by line, tracking current `[section]`, looking for:
 *   - `model_provider = "..."` at the root
 *   - `model = "..."` at the root
 *   - `base_url = "..."` inside any `[model_providers.X]` table
 */
export function probeLocalCodexGateway(): LocalCodexGatewayProbe {
  const raw = readFileSilent(path.join(os.homedir(), ".codex", "config.toml"));
  if (!raw) return EMPTY_CODEX_PROBE;

  let currentSection = "";
  let hasModelProvider = false;
  let hasModel = false;
  let hasCustomProviderBaseUrl = false;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const valueRaw = kvMatch[2].trim().replace(/[,;]\s*$/, "");
    const value = unquoteToml(valueRaw);
    if (!value) continue;

    if (currentSection === "") {
      if (key === "model_provider") hasModelProvider = true;
      else if (key === "model") hasModel = true;
    } else if (currentSection.startsWith("model_providers.")) {
      if (key === "base_url") hasCustomProviderBaseUrl = true;
    }
  }

  return { hasModelProvider, hasModel, hasCustomProviderBaseUrl };
}

function unquoteToml(s: string): string {
  if (!s) return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export interface LocalCodexProvider {
  /** Root `model_provider = "..."` selecting the active provider, if any. */
  provider: string | null;
  /** Root `model = "..."`, if any. */
  model: string | null;
  /** base_url of the active `[model_providers.<provider>]` table, if resolvable. */
  baseUrl: string | null;
}

/**
 * Read the active provider details from ~/.codex/config.toml: the root
 * `model_provider`/`model`, and the matching provider table's `base_url`.
 * Used to surface the config PccAgent inherits when the local Codex config wins.
 */
export function loadLocalCodexProvider(): LocalCodexProvider {
  const raw = readFileSilent(path.join(os.homedir(), ".codex", "config.toml"));
  if (!raw) return { provider: null, model: null, baseUrl: null };

  let currentSection = "";
  let provider: string | null = null;
  let model: string | null = null;
  const providerBaseUrls = new Map<string, string>();

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const value = unquoteToml(kvMatch[2].trim().replace(/[,;]\s*$/, ""));
    if (!value) continue;

    if (currentSection === "") {
      if (key === "model_provider") provider = value;
      else if (key === "model") model = value;
    } else if (currentSection.startsWith("model_providers.") && key === "base_url") {
      providerBaseUrls.set(currentSection.slice("model_providers.".length), value);
    }
  }

  const baseUrl = provider ? (providerBaseUrls.get(provider) ?? null) : null;
  return { provider, model, baseUrl };
}

/** Does the user's local Claude config set anything that conflicts with PccAgent's gateway? */
export function localClaudeGatewayTakesPriority(): boolean {
  const probe = probeLocalClaudeGateway();
  return probe.hasBaseUrl || probe.hasAuthToken || probe.hasApiKey;
}

/** Does the user's local Codex config set anything that conflicts with PccAgent's gateway? */
export function localCodexGatewayTakesPriority(): boolean {
  const probe = probeLocalCodexGateway();
  // Treat any of these as "user has a deliberate provider setup we shouldn't override":
  //   - a custom model_provider chosen at the root
  //   - a custom provider entry with a base_url
  return probe.hasModelProvider || probe.hasCustomProviderBaseUrl;
}

/**
 * Read the full env block from ~/.claude/settings.json as a plain string map.
 *
 * Used to seed spawn env for processes PccAgent launches (e.g. the toolbar terminal's
 * shell, which would otherwise inherit only what the GUI launcher gives + whatever
 * .zshrc manages to export before any syntax errors). Returns {} when missing.
 */
export function loadLocalClaudeEnv(): Record<string, string> {
  const raw = readFileSilent(path.join(os.homedir(), ".claude", "settings.json"));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const env = parsed?.env;
    if (!env || typeof env !== "object" || Array.isArray(env)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
