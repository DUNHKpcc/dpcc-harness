/** Types mirroring the ACP registry JSON at cdn.agentclientprotocol.com */

import type { ACPConfigOption } from "./acp";
import type { EngineId, SlashCommand } from "./engine";

// ── Installed agent (shared between electron and renderer) ──

export interface InstalledAgent {
  id: string;
  name: string;
  engine: EngineId;
  binary?: string;
  args?: string[];
  env?: Record<string, string>;
  icon?: string;
  builtIn?: boolean;
  /** Matching id from the ACP registry (for update detection) */
  registryId?: string;
  /** Version from the registry at install time */
  registryVersion?: string;
  /** Description from the registry, shown in agent cards */
  description?: string;
  /** Cached config options from the last ACP session — shown before session starts */
  cachedConfigOptions?: ACPConfigOption[];
  /** Cached slash commands from the last ACP session — available in draft mode. */
  cachedSlashCommands?: SlashCommand[];
}

export type PiModelCacheRefreshResult =
  | {
      ok: true;
      modelCount: number;
      updated: boolean;
    }
  | {
      ok: false;
      error: string;
      skipped?: boolean;
    };

/** Stable identity of the only built-in runtime in Pi-only builds. */
export const BUILTIN_PI_AGENT_ID = "pi-acp" as const;

/** Renderer-safe token for Pi's official compact badge. */
export const PI_OFFICIAL_ICON = "builtin:pi-official-badge" as const;

/** Built-in commands advertised by the pinned pi-acp adapter. */
export const PI_BUILTIN_SLASH_COMMANDS = [
  {
    name: "compact",
    description: "Manually compact the session context",
    argumentHint: "optional custom instructions",
    source: "acp",
  },
  {
    name: "autocompact",
    description: "Toggle automatic context compaction",
    argumentHint: "on|off|toggle",
    source: "acp",
  },
  {
    name: "export",
    description: "Export session to an HTML file in the session cwd",
    source: "acp",
  },
  {
    name: "session",
    description: "Show session stats (messages, tokens, cost, session file)",
    source: "acp",
  },
  {
    name: "name",
    description: "Set session display name",
    argumentHint: "<name>",
    source: "acp",
  },
  {
    name: "steering",
    description: "Get or set Pi steering message delivery mode",
    argumentHint: "all | one-at-a-time",
    source: "acp",
  },
  {
    name: "follow-up",
    description: "Get or set Pi follow-up message delivery mode",
    argumentHint: "all | one-at-a-time",
    source: "acp",
  },
  {
    name: "changelog",
    description: "Show Pi changelog",
    source: "acp",
  },
] satisfies SlashCommand[];

/**
 * Keep this definition in shared code so main, renderer, and tests cannot
 * silently grow different ideas of which agent is built in.
 */
export const BUILTIN_PI_AGENT: InstalledAgent = {
  id: BUILTIN_PI_AGENT_ID,
  name: "Pi",
  engine: "acp",
  builtIn: true,
  registryId: BUILTIN_PI_AGENT_ID,
  registryVersion: "0.0.33",
  binary: "bundled:pi-acp",
  icon: PI_OFFICIAL_ICON,
  cachedSlashCommands: [...PI_BUILTIN_SLASH_COMMANDS],
};

// ── Binary resolution result (shared between electron and renderer) ──

export interface BinaryCheckResult {
  path: string;
  args?: string[];
}

export type PiRuntimeBinaryName = "pi" | "pi-acp" | "pi-mcp-adapter";

export type PiRuntimeBinaryStatusKind =
  | "ok"
  | "missing"
  | "version-mismatch"
  | "version-unreadable";

export type PiRuntimeBinaryErrorCode =
  | "pi_runtime_host_missing"
  | "pi_bundled_wrapper_missing"
  | "pi_bundled_package_missing"
  | "pi_acp_bundled_package_missing"
  | "pi_mcp_bundled_package_missing"
  | "pi_mcp_bridge_missing"
  | "pi_bundled_version_mismatch"
  | "pi_acp_bundled_version_mismatch"
  | "pi_mcp_bundled_version_mismatch"
  | null;

/** Safe, credential-free runtime details displayed by the Pi settings panel. */
export interface PiRuntimeBinaryStatus {
  binary: PiRuntimeBinaryName;
  packageName: string;
  source: "bundled";
  available: boolean;
  resolvedPath: string | null;
  expectedVersion: string;
  actualVersion: string | null;
  status: PiRuntimeBinaryStatusKind;
  code: PiRuntimeBinaryErrorCode;
}

export interface PiRuntimeStatus {
  source: "bundled";
  offlineReady: boolean;
  runtimeHostPath: string;
  runtimeHostAvailable: boolean;
  pi: PiRuntimeBinaryStatus;
  piAcp: PiRuntimeBinaryStatus;
  piMcpAdapter: PiRuntimeBinaryStatus;
  checkedAt: string;
}

// ── ACP registry types ──

export interface RegistryNpxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface RegistryBinaryTarget {
  archive: string;
  cmd: string;
  args?: string[];
}

export interface RegistryDistribution {
  npx?: RegistryNpxDistribution;
  /** Platform keys: "darwin-aarch64", "darwin-x86_64", "linux-aarch64", etc. */
  binary?: Record<string, RegistryBinaryTarget>;
}

export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  repository?: string;
  authors: string[];
  license: string;
  icon?: string; // SVG URL from CDN
  distribution: RegistryDistribution;
}

export interface RegistryData {
  version: string;
  agents: RegistryAgent[];
}
