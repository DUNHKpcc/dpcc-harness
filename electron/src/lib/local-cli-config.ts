/**
 * Lightweight probes for the user's local Claude Code / Codex CLI configuration.
 *
 * Goal: when the user has already configured a custom gateway in their CLI's
 * own config file, Harnss's own gateway settings should not override it.
 *
 * These probes do not parse the full config — they only detect whether the
 * fields that would conflict with Harnss's gateway injection are present.
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

/** Does the user's local Claude config set anything that conflicts with Harnss's gateway? */
export function localClaudeGatewayTakesPriority(): boolean {
  const probe = probeLocalClaudeGateway();
  return probe.hasBaseUrl || probe.hasAuthToken || probe.hasApiKey;
}

/** Does the user's local Codex config set anything that conflicts with Harnss's gateway? */
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
 * Used to seed spawn env for processes Harnss launches (e.g. the toolbar terminal's
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
