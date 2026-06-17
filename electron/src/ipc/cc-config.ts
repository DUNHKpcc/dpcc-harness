import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import { reportError } from "../lib/error-utils";
import type {
  LocalAgentInfo,
  LocalCliConfig,
  LocalClaudeConfig,
  LocalClaudeGatewayEnv,
  LocalClaudeMdEntry,
  LocalCodexConfig,
  LocalCommandInfo,
  LocalMcpServerInfo,
} from "@shared/types/cc-config";
import {
  localClaudeGatewayTakesPriority,
  localCodexGatewayTakesPriority,
} from "../lib/local-cli-config";

interface ParsedMarkdown {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

/**
 * Minimal YAML-frontmatter parser — handles the subset Claude Code agent/command
 * files use: simple key: value pairs, arrays as `[a, b, c]` or `- item` lists,
 * and quoted strings. Avoids pulling a dependency for a few config files.
 */
function parseFrontmatter(raw: string): ParsedMarkdown {
  const text = raw.replace(/^﻿/, "");
  if (!text.startsWith("---")) {
    return { frontmatter: null, body: text };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: null, body: text };
  }
  const yamlBlock = text.slice(3, end).replace(/^\r?\n/, "");
  const bodyStart = text.indexOf("\n", end + 3);
  const body = bodyStart === -1 ? "" : text.slice(bodyStart + 1);

  const frontmatter: Record<string, unknown> = {};
  const lines = yamlBlock.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of lines) {
    if (!line.trim()) {
      currentKey = null;
      currentList = null;
      continue;
    }

    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey && currentList) {
      currentList.push(unquote(listMatch[1].trim()));
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const valueRaw = kvMatch[2].trim();
    currentKey = key;
    currentList = null;

    if (!valueRaw) {
      // Likely a block list follows
      const list: string[] = [];
      frontmatter[key] = list;
      currentList = list;
      continue;
    }

    if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      const inner = valueRaw.slice(1, -1).trim();
      frontmatter[key] = inner
        ? inner.split(",").map((s) => unquote(s.trim())).filter(Boolean)
        : [];
      continue;
    }

    frontmatter[key] = unquote(valueRaw);
  }

  return { frontmatter, body };
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function readUtf8(filePath: string, maxBytes = 1_048_576): string {
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
}

function parseSettings(settingsPath: string): {
  parsed: Record<string, unknown> | null;
  error: string | null;
} {
  if (!fs.existsSync(settingsPath)) {
    return { parsed: null, error: null };
  }
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const trimmed = raw.trim();
    if (!trimmed) return { parsed: null, error: null };
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { parsed: parsed as Record<string, unknown>, error: null };
    }
    return { parsed: null, error: "settings.json is not an object" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { parsed: null, error: msg };
  }
}

function extractGatewayEnv(settings: Record<string, unknown> | null): LocalClaudeGatewayEnv {
  const out: LocalClaudeGatewayEnv = {
    ANTHROPIC_BASE_URL: null,
    ANTHROPIC_AUTH_TOKEN: null,
    ANTHROPIC_API_KEY: null,
    ANTHROPIC_MODEL: null,
    allKeys: [],
  };
  const env = settings?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return out;

  const envMap = env as Record<string, unknown>;
  out.allKeys = Object.keys(envMap).sort();

  const pickString = (k: keyof LocalClaudeGatewayEnv): string | null => {
    const v = envMap[k as string];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  out.ANTHROPIC_BASE_URL = pickString("ANTHROPIC_BASE_URL");
  out.ANTHROPIC_AUTH_TOKEN = pickString("ANTHROPIC_AUTH_TOKEN");
  out.ANTHROPIC_API_KEY = pickString("ANTHROPIC_API_KEY");
  out.ANTHROPIC_MODEL = pickString("ANTHROPIC_MODEL");
  return out;
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".md"))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

function loadAgent(filePath: string): LocalAgentInfo | null {
  try {
    const stat = fs.statSync(filePath);
    const raw = readUtf8(filePath);
    const { frontmatter, body } = parseFrontmatter(raw);
    const fm = frontmatter ?? {};

    const description = typeof fm.description === "string" ? fm.description : null;
    const model = typeof fm.model === "string" ? fm.model : null;
    let tools: string[] | null = null;
    const fmTools = fm.tools;
    if (Array.isArray(fmTools)) {
      tools = fmTools.filter((t): t is string => typeof t === "string");
    } else if (typeof fmTools === "string") {
      // Comma- or whitespace-separated string fallback
      tools = fmTools
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    return {
      name: path.basename(filePath, ".md"),
      filePath,
      description,
      tools,
      model,
      body,
      fileSize: stat.size,
      modifiedAt: stat.mtimeMs,
    };
  } catch (err) {
    reportError("CC_CONFIG:LOAD_AGENT_ERR", err, { filePath });
    return null;
  }
}

function loadCommand(filePath: string): LocalCommandInfo | null {
  try {
    const stat = fs.statSync(filePath);
    const raw = readUtf8(filePath);
    const { frontmatter, body } = parseFrontmatter(raw);
    const fm = frontmatter ?? {};

    return {
      name: path.basename(filePath, ".md"),
      filePath,
      description: typeof fm.description === "string" ? fm.description : null,
      argumentHint: typeof fm["argument-hint"] === "string" ? (fm["argument-hint"] as string) : null,
      body,
      fileSize: stat.size,
      modifiedAt: stat.mtimeMs,
    };
  } catch (err) {
    reportError("CC_CONFIG:LOAD_COMMAND_ERR", err, { filePath });
    return null;
  }
}

function loadClaudeMd(filePath: string, scope: "user" | "project"): LocalClaudeMdEntry | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const content = readUtf8(filePath, 2_097_152); // 2 MB cap
    return {
      scope,
      filePath,
      content,
      fileSize: stat.size,
      modifiedAt: stat.mtimeMs,
    };
  } catch (err) {
    reportError("CC_CONFIG:LOAD_CLAUDE_MD_ERR", err, { filePath });
    return null;
  }
}

function extractMcpServers(settings: Record<string, unknown> | null): LocalMcpServerInfo[] {
  const raw = settings?.mcpServers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  const out: LocalMcpServerInfo[] = [];
  for (const [name, configRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!configRaw || typeof configRaw !== "object" || Array.isArray(configRaw)) continue;
    const config = configRaw as Record<string, unknown>;

    const command = typeof config.command === "string" ? config.command : null;
    const url = typeof config.url === "string" ? config.url : null;
    const argsRaw = config.args;
    const args = Array.isArray(argsRaw)
      ? argsRaw.filter((a): a is string => typeof a === "string")
      : [];
    const envRaw = config.env;
    const env: Record<string, string> = {};
    if (envRaw && typeof envRaw === "object" && !Array.isArray(envRaw)) {
      for (const [k, v] of Object.entries(envRaw as Record<string, unknown>)) {
        if (typeof v === "string") env[k] = v;
      }
    }

    const typeRaw = typeof config.type === "string" ? (config.type as string).toLowerCase() : null;
    let type: LocalMcpServerInfo["type"];
    if (typeRaw === "sse" || typeRaw === "http") {
      type = typeRaw;
    } else if (typeRaw === "stdio") {
      type = "stdio";
    } else if (command) {
      type = "stdio";
    } else if (url) {
      type = "http";
    } else {
      type = "unknown";
    }

    out.push({ name, command, args, env, url, type });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function loadLocalClaudeConfig(cwd?: string): LocalClaudeConfig {
  const rootDir = path.join(os.homedir(), ".claude");
  const exists = fs.existsSync(rootDir);
  const settingsPath = path.join(rootDir, "settings.json");
  const { parsed: settings, error: settingsError } = parseSettings(settingsPath);

  const claudeMdFiles: LocalClaudeMdEntry[] = [];
  const userClaudeMd = loadClaudeMd(path.join(rootDir, "CLAUDE.md"), "user");
  if (userClaudeMd) claudeMdFiles.push(userClaudeMd);
  if (cwd) {
    const projectClaudeMd = loadClaudeMd(path.join(cwd, "CLAUDE.md"), "project");
    if (projectClaudeMd) claudeMdFiles.push(projectClaudeMd);
  }

  const agents = listMarkdownFiles(path.join(rootDir, "agents"))
    .map(loadAgent)
    .filter((a): a is LocalAgentInfo => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const commands = listMarkdownFiles(path.join(rootDir, "commands"))
    .map(loadCommand)
    .filter((c): c is LocalCommandInfo => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    exists,
    rootDir,
    settings,
    settingsPath,
    settingsError,
    gatewayEnv: extractGatewayEnv(settings),
    claudeMdFiles,
    agents,
    commands,
    mcpServers: extractMcpServers(settings),
    takesPriorityOverHarnss: localClaudeGatewayTakesPriority(),
  };
}

function loadLocalCodexConfig(): LocalCodexConfig {
  const rootDir = path.join(os.homedir(), ".codex");
  const exists = fs.existsSync(rootDir);
  const configPath = path.join(rootDir, "config.toml");
  const configExists = fs.existsSync(configPath);

  let preview = "";
  let configSize = 0;
  let modifiedAt = 0;
  let modelProvider: string | null = null;
  let model: string | null = null;
  const customProviders: string[] = [];

  if (configExists) {
    try {
      const stat = fs.statSync(configPath);
      configSize = stat.size;
      modifiedAt = stat.mtimeMs;
      const raw = fs.readFileSync(configPath, "utf-8");
      preview = raw.split(/\r?\n/).slice(0, 16).join("\n");

      let currentSection = "";
      const providerBaseUrls = new Map<string, boolean>();
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
          if (key === "model_provider") modelProvider = value;
          else if (key === "model") model = value;
        } else if (currentSection.startsWith("model_providers.")) {
          const providerName = currentSection.slice("model_providers.".length);
          if (key === "base_url") providerBaseUrls.set(providerName, true);
        }
      }
      customProviders.push(...providerBaseUrls.keys());
    } catch (err) {
      reportError("CC_CONFIG:LOAD_CODEX_CONFIG_ERR", err, { configPath });
    }
  }

  return {
    exists,
    rootDir,
    configPath,
    configExists,
    configSize,
    modifiedAt,
    preview,
    modelProvider,
    model,
    customProviders,
    takesPriorityOverHarnss: localCodexGatewayTakesPriority(),
  };
}

function unquoteToml(s: string): string {
  if (!s) return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function emptyClaudeConfig(error: string | null): LocalClaudeConfig {
  return {
    exists: false,
    rootDir: path.join(os.homedir(), ".claude"),
    settings: null,
    settingsPath: path.join(os.homedir(), ".claude", "settings.json"),
    settingsError: error,
    gatewayEnv: {
      ANTHROPIC_BASE_URL: null,
      ANTHROPIC_AUTH_TOKEN: null,
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_MODEL: null,
      allKeys: [],
    },
    claudeMdFiles: [],
    agents: [],
    commands: [],
    mcpServers: [],
    takesPriorityOverHarnss: false,
  };
}

function emptyCodexConfig(): LocalCodexConfig {
  return {
    exists: false,
    rootDir: path.join(os.homedir(), ".codex"),
    configPath: path.join(os.homedir(), ".codex", "config.toml"),
    configExists: false,
    configSize: 0,
    modifiedAt: 0,
    preview: "",
    modelProvider: null,
    model: null,
    customProviders: [],
    takesPriorityOverHarnss: false,
  };
}

export function register(): void {
  ipcMain.handle("cc-config:read", async (_event, options?: { cwd?: string }) => {
    try {
      // Kept for backward-compat — claude-only payload
      return loadLocalClaudeConfig(options?.cwd);
    } catch (err) {
      reportError("CC_CONFIG:READ_ERR", err);
      return emptyClaudeConfig(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle("cc-config:read-all", async (_event, options?: { cwd?: string }) => {
    try {
      return {
        claude: loadLocalClaudeConfig(options?.cwd),
        codex: loadLocalCodexConfig(),
      } satisfies LocalCliConfig;
    } catch (err) {
      reportError("CC_CONFIG:READ_ALL_ERR", err);
      return {
        claude: emptyClaudeConfig(err instanceof Error ? err.message : String(err)),
        codex: emptyCodexConfig(),
      } satisfies LocalCliConfig;
    }
  });
}
