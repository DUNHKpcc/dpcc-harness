import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { app } from "electron";
import {
  BUILTIN_PI_AGENT,
  BUILTIN_PI_AGENT_ID,
  type InstalledAgent,
  type BinaryCheckResult,
} from "@shared/types/registry";
import type { ACPConfigOption } from "@shared/types/acp";
import type { SlashCommand } from "@shared/types/engine";
import {
  normalizeCachedAcpConfigOptions,
  normalizeCachedAcpSlashCommands,
} from "@shared/lib/acp-config-cache";

// Re-export shared types so existing consumers importing from this file still work
export type { InstalledAgent, BinaryCheckResult } from "@shared/types/registry";
export type { EngineId } from "@shared/types/engine";

const execFileAsync = promisify(execFile);

export const BUILTIN_IDS = new Set<string>([BUILTIN_PI_AGENT_ID]);

const agents = new Map<string, InstalledAgent>();
agents.set(BUILTIN_PI_AGENT.id, { ...BUILTIN_PI_AGENT });

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "pcc-agent-data", "agents.json");
}

export function loadUserAgents(): void {
  try {
    const data = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    if (!Array.isArray(data)) return;
    for (const agent of data) {
      if (agent?.id === BUILTIN_PI_AGENT_ID) {
        const cachedConfigOptions = normalizeCachedAcpConfigOptions(agent.cachedConfigOptions);
        const cachedSlashCommands = normalizeCachedAcpSlashCommands(agent.cachedSlashCommands);
        agents.set(BUILTIN_PI_AGENT_ID, {
          ...BUILTIN_PI_AGENT,
          ...(cachedConfigOptions.length > 0 ? { cachedConfigOptions } : {}),
          ...(cachedSlashCommands.length > 0 ? { cachedSlashCommands } : {}),
        });
        continue;
      }
      // Legacy Claude/Codex definitions remain on disk for rollback and data
      // compatibility, but are not activated as new runtimes.
      if (
        agent
        && typeof agent === "object"
        && !BUILTIN_IDS.has(agent.id)
        && agent.engine === "acp"
        && typeof agent.id === "string"
        && typeof agent.name === "string"
      ) {
        agents.set(agent.id, agent as InstalledAgent);
      }
    }
  } catch {
    /* no config yet */
  }
}

export function getAgent(id: string): InstalledAgent | undefined {
  return agents.get(id);
}

export function listAgents(): InstalledAgent[] {
  return Array.from(agents.values());
}

export function saveAgent(agent: InstalledAgent): void {
  if (BUILTIN_IDS.has(agent.id)) return; // Protect built-in agents
  if (!agent.id?.trim() || !agent.name?.trim()) throw new Error("Agent must have id and name");
  if (agent.engine !== "acp") throw new Error("Only ACP agents can be installed");
  if (!agent.binary?.trim()) throw new Error("ACP agents require a binary");
  agents.set(agent.id, agent);
  persistUserAgents();
}

export function deleteAgent(id: string): void {
  if (BUILTIN_IDS.has(id)) return;
  agents.delete(id);
  persistUserAgents();
}

/** Update only the cached config options for an agent (fire-and-forget from renderer) */
export function updateCachedConfig(id: string, configOptions: ACPConfigOption[]): void {
  const agent = agents.get(id);
  if (!agent) return;
  agents.set(id, {
    ...agent,
    cachedConfigOptions: normalizeCachedAcpConfigOptions(configOptions),
  });
  persistUserAgents();
}

export function updateCachedSlashCommands(id: string, commands: SlashCommand[]): void {
  const agent = agents.get(id);
  if (!agent) return;
  agents.set(id, {
    ...agent,
    cachedSlashCommands: normalizeCachedAcpSlashCommands(commands),
  });
  persistUserAgents();
}

function persistUserAgents(): void {
  const builtInPi = agents.get(BUILTIN_PI_AGENT_ID);
  const cachedPiConfig = normalizeCachedAcpConfigOptions(builtInPi?.cachedConfigOptions);
  const cachedPiCommands = normalizeCachedAcpSlashCommands(builtInPi?.cachedSlashCommands);
  const userAgents = listAgents().filter((a) => !a.builtIn);
  const persistedAgents = cachedPiConfig.length > 0 || cachedPiCommands.length > 0
    ? [{
        ...BUILTIN_PI_AGENT,
        ...(cachedPiConfig.length > 0 ? { cachedConfigOptions: cachedPiConfig } : {}),
        ...(cachedPiCommands.length > 0 ? { cachedSlashCommands: cachedPiCommands } : {}),
      }, ...userAgents]
    : userAgents;
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(persistedAgents, null, 2));
}

// ── Binary detection helpers ──

/** Map process.platform + process.arch to preferred registry platform keys (in order). */
export function getRegistryPlatformKeys(): string[] {
  const archMap: Record<string, string> = { arm64: "aarch64", x64: "x86_64" };
  const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" };
  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];
  if (!platform || !arch) return [];

  if (process.platform === "win32") {
    return ["windows-x86_64"];
  }

  const primary = `${platform}-${arch}`;
  return [primary];
}

/** Resolve a command name to its absolute path via `which` (or `where` on Windows). */
async function resolveWhich(cmd: string): Promise<string | null> {
  if (!cmd.trim()) return null;
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(whichCmd, [cmd]);
    // `where` on Windows may return multiple CRLF lines; take the first non-empty.
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null;
  } catch {
    return null; // command not found
  }
}

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Windows fallback for binaries installed in a bash-managed PATH (e.g. Git Bash).
 * Returns a runnable command via `bash -lc <cmd ...>` when detection succeeds.
 */
async function resolveViaBash(
  cmd: string,
  targetArgs?: string[],
): Promise<BinaryCheckResult | null> {
  if (process.platform !== "win32" || !cmd.trim()) return null;

  const loginCommand = [cmd, ...(targetArgs ?? [])].map(quotePosixArg).join(" ");
  for (const shell of ["bash", "sh"]) {
    try {
      const { stdout } = await execFileAsync(shell, ["-lc", `command -v ${quotePosixArg(cmd)}`]);
      const found = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (found) {
        return { path: shell, args: ["-lc", loginCommand] };
      }
    } catch {
      // Try next shell candidate.
    }
  }

  return null;
}

/**
 * Convert registry cmd (which may include relative paths/quotes/extensions) to
 * a bare executable name for PATH lookup.
 */
function extractBinaryName(cmd: string): string {
  const trimmed = cmd.trim();
  if (!trimmed) return "";

  const match = trimmed.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  const executable = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  const normalized = executable.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

/**
 * Batch-check which binary-only agents have their command available on the system PATH.
 * Receives raw binary distribution maps from registry agents, resolves the current platform,
 * and runs `which`/`where` for each matching command.
 */
export async function checkBinaries(
  agents: Array<{ id: string; binary: Record<string, { cmd: string; args?: string[] }> }>,
): Promise<Record<string, BinaryCheckResult | null>> {
  const keys = getRegistryPlatformKeys();
  if (keys.length === 0) return {};

  const results: Record<string, BinaryCheckResult | null> = {};
  await Promise.all(
    agents.map(async ({ id, binary }) => {
      const target = keys.map((k) => binary[k]).find((candidate) => candidate != null);
      if (!target) {
        results[id] = null;
        return;
      }
      const cmdName = extractBinaryName(target.cmd);
      const resolved = await resolveWhich(cmdName);
      if (resolved) {
        results[id] = { path: resolved, args: target.args };
        return;
      }
      results[id] = await resolveViaBash(cmdName, target.args);
    }),
  );
  return results;
}
