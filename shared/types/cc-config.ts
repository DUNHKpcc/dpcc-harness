/**
 * Local Claude Code (~/.claude/) configuration as surfaced read-only to the UI.
 * Populated by electron/src/ipc/cc-config.ts; consumed by the LocalClaudeSettings panel.
 */

export interface LocalAgentInfo {
  /** Filename without .md extension */
  name: string;
  /** Absolute file path */
  filePath: string;
  /** Frontmatter description (if present) */
  description: string | null;
  /** Frontmatter tools list (if present) */
  tools: string[] | null;
  /** Frontmatter model id (if present) */
  model: string | null;
  /** Body content (frontmatter stripped) */
  body: string;
  fileSize: number;
  modifiedAt: number;
}

export interface LocalCommandInfo {
  name: string;
  filePath: string;
  description: string | null;
  argumentHint: string | null;
  body: string;
  fileSize: number;
  modifiedAt: number;
}

export interface LocalMcpServerInfo {
  name: string;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  type: "stdio" | "sse" | "http" | "unknown";
}

export interface LocalClaudeMdEntry {
  scope: "user" | "project";
  filePath: string;
  content: string;
  fileSize: number;
  modifiedAt: number;
}

export interface LocalClaudeGatewayEnv {
  ANTHROPIC_BASE_URL: string | null;
  ANTHROPIC_AUTH_TOKEN: string | null;
  ANTHROPIC_API_KEY: string | null;
  ANTHROPIC_MODEL: string | null;
  allKeys: string[];
}

export interface LocalClaudeConfig {
  exists: boolean;
  rootDir: string;
  settings: Record<string, unknown> | null;
  settingsPath: string;
  settingsError: string | null;
  gatewayEnv: LocalClaudeGatewayEnv;
  claudeMdFiles: LocalClaudeMdEntry[];
  agents: LocalAgentInfo[];
  commands: LocalCommandInfo[];
  mcpServers: LocalMcpServerInfo[];
  /** True when the local config overrides Harnss's own Claude gateway settings. */
  takesPriorityOverHarnss: boolean;
}

/** Lightweight snapshot of ~/.codex/config.toml — enough to tell whether the user
 *  has configured a custom provider that should override Harnss's own Codex gateway. */
export interface LocalCodexConfig {
  exists: boolean;
  rootDir: string;
  configPath: string;
  configExists: boolean;
  configSize: number;
  modifiedAt: number;
  /** First 16 lines of config.toml (comments stripped of secrets is up to the user). */
  preview: string;
  /** model_provider = "..." at the root, if present */
  modelProvider: string | null;
  /** model = "..." at the root, if present */
  model: string | null;
  /** Names of `[model_providers.X]` tables with a non-empty base_url */
  customProviders: string[];
  takesPriorityOverHarnss: boolean;
}

export interface LocalCliConfig {
  claude: LocalClaudeConfig;
  codex: LocalCodexConfig;
}
