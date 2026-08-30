import fs from "fs";
import os from "os";
import path from "path";
import { parse as parseYaml } from "yaml";
import { PI_BUILTIN_SLASH_COMMANDS } from "@shared/types/registry";
import type { SlashCommand } from "@shared/types/engine";
import { getDataDir } from "./data-dir";
import { resolvePiUpstream } from "./upstream-resolver";

const MAX_DISCOVERED_COMMANDS = 512;

interface PiCommandCatalogOptions {
  agentDir?: string;
  homeDir?: string;
}

interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseMarkdown(contents: string): ParsedMarkdown {
  const match = contents.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { frontmatter: {}, body: contents };
  try {
    const parsed = parseYaml(match[1]);
    return {
      frontmatter: isRecord(parsed) ? parsed : {},
      body: contents.slice(match[0].length),
    };
  } catch {
    return { frontmatter: {}, body: contents.slice(match[0].length) };
  }
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isRecord(merged[key]) && isRecord(value)
      ? deepMerge(merged[key] as Record<string, unknown>, value)
      : value;
  }
  return merged;
}

function resolveAgentDir(homeDir: string): string {
  if (resolvePiUpstream().tier !== "local") {
    return path.join(getDataDir(), "pi-agent");
  }
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(homeDir, ".pi", "agent");
}

function resolveResourcePath(value: string, cwd: string, homeDir: string): string {
  const expanded = value === "~"
    ? homeDir
    : value.startsWith("~/") || value.startsWith("~\\")
      ? path.join(homeDir, value.slice(2))
      : value;
  return path.resolve(cwd, expanded);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function markdownFiles(
  resourcePath: string,
  recursive: boolean,
  remaining: () => boolean,
): string[] {
  const files: string[] = [];
  const visited = new Set<string>();
  const canCollect = () => remaining() && files.length < MAX_DISCOVERED_COMMANDS;
  const visit = (candidate: string): void => {
    if (!canCollect()) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      return;
    }
    if (stat.isFile()) {
      if (candidate.toLowerCase().endsWith(".md")) files.push(candidate);
      return;
    }
    if (!stat.isDirectory()) return;

    let canonical: string;
    try {
      canonical = fs.realpathSync(candidate);
    } catch {
      return;
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(candidate, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!canCollect()) return;
      const fullPath = path.join(candidate, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (recursive) visit(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  };
  visit(resourcePath);
  return files;
}

function promptCommand(filePath: string): SlashCommand | null {
  try {
    const { frontmatter, body } = parseMarkdown(fs.readFileSync(filePath, "utf8"));
    const name = path.basename(filePath, path.extname(filePath)).trim();
    if (!name) return null;
    const configuredDescription = frontmatter.description;
    const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
    const description = typeof configuredDescription === "string" && configuredDescription.trim()
      ? configuredDescription.trim()
      : firstLine.length > 60
        ? `${firstLine.slice(0, 60)}...`
        : firstLine;
    const argumentHint = frontmatter["argument-hint"];
    return {
      name,
      description,
      ...(typeof argumentHint === "string" && argumentHint.trim()
        ? { argumentHint: argumentHint.trim() }
        : {}),
      source: "acp",
    };
  } catch {
    return null;
  }
}

function skillCommand(filePath: string): SlashCommand | null {
  try {
    const { frontmatter } = parseMarkdown(fs.readFileSync(filePath, "utf8"));
    const configuredName = frontmatter.name;
    const configuredDescription = frontmatter.description;
    const name = typeof configuredName === "string" && configuredName.trim()
      ? configuredName.trim()
      : path.basename(path.dirname(filePath));
    if (!name || typeof configuredDescription !== "string" || !configuredDescription.trim()) {
      return null;
    }
    return {
      name: `skill:${name}`,
      description: configuredDescription.trim(),
      source: "acp",
    };
  } catch {
    return null;
  }
}

function skillFiles(resourcePath: string, remaining: () => boolean): string[] {
  const files: string[] = [];
  const visited = new Set<string>();
  const canCollect = () => remaining() && files.length < MAX_DISCOVERED_COMMANDS;
  const visit = (candidate: string, includeRootMarkdown: boolean): void => {
    if (!canCollect()) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      return;
    }
    if (stat.isFile()) {
      if (candidate.toLowerCase().endsWith(".md")) files.push(candidate);
      return;
    }
    if (!stat.isDirectory()) return;

    let canonical: string;
    try {
      canonical = fs.realpathSync(candidate);
    } catch {
      return;
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(candidate, { withFileTypes: true });
    } catch {
      return;
    }
    const rootSkill = entries.find((entry) => entry.name === "SKILL.md");
    if (rootSkill) {
      files.push(path.join(candidate, rootSkill.name));
      return;
    }
    for (const entry of entries) {
      if (!canCollect() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(candidate, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        visit(fullPath, false);
      } else if (includeRootMarkdown && entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  };
  visit(resourcePath, true);
  return files;
}

/** Build Pi's draft command catalog from local files only. This never starts Pi. */
export function listPiDraftSlashCommands(
  cwd: string,
  options: PiCommandCatalogOptions = {},
): SlashCommand[] {
  if (!path.isAbsolute(cwd)) {
    throw new Error("Pi draft command catalog requires an absolute cwd.");
  }
  const homeDir = options.homeDir ?? os.homedir();
  const agentDir = options.agentDir ?? resolveAgentDir(homeDir);
  const settings = deepMerge(
    readJsonObject(path.join(agentDir, "settings.json")),
    readJsonObject(path.join(cwd, ".pi", "settings.json")),
  );
  const nestedSkills = isRecord(settings.skills) ? settings.skills : {};
  const enableSkillCommands = typeof settings.enableSkillCommands === "boolean"
    ? settings.enableSkillCommands
    : typeof nestedSkills.enableSkillCommands === "boolean"
      ? nestedSkills.enableSkillCommands
      : true;

  const commands: SlashCommand[] = [];
  const seenNames = new Set<string>();
  const remaining = () => commands.length < MAX_DISCOVERED_COMMANDS;
  const add = (command: SlashCommand | null): void => {
    if (!command || seenNames.has(command.name) || !remaining()) return;
    seenNames.add(command.name);
    commands.push(command);
  };

  const promptPaths = [
    path.join(agentDir, "prompts"),
    path.join(cwd, ".pi", "prompts"),
    ...stringArray(settings.prompts).map((entry) => resolveResourcePath(entry, cwd, homeDir)),
  ];
  for (const promptPath of promptPaths) {
    for (const filePath of markdownFiles(promptPath, true, remaining)) add(promptCommand(filePath));
  }

  if (enableSkillCommands) {
    const skillPaths = [
      path.join(agentDir, "skills"),
      path.join(cwd, ".pi", "skills"),
      path.join(homeDir, ".agents", "skills"),
      path.join(cwd, ".agents", "skills"),
      ...stringArray(settings.skills).map((entry) => resolveResourcePath(entry, cwd, homeDir)),
    ];
    for (const skillPath of skillPaths) {
      for (const filePath of skillFiles(skillPath, remaining)) add(skillCommand(filePath));
    }
  }

  for (const command of PI_BUILTIN_SLASH_COMMANDS) {
    if (seenNames.has(command.name)) continue;
    seenNames.add(command.name);
    commands.push({ ...command });
  }
  return commands;
}
