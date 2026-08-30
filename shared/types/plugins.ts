export type CatalogFreshness = "fresh" | "stale";

export interface CatalogResult<T> {
  items: T[];
  source: string;
  fetchedAt: string;
  freshness: CatalogFreshness;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  source: string;
  installs: number;
  url: string;
  iconUrl?: string;
  installable: boolean;
}

export type SkillInstallScope = "global";
/** Persisted by older Plugin Center builds and accepted only for safe migration/removal. */
export type StoredSkillInstallScope = SkillInstallScope | "project";
export type SkillTarget = "pi";
/** Persisted by older Plugin Center builds and accepted only for safe update/removal. */
export type StoredSkillTarget = SkillTarget | "claude-code" | "codex";

export interface SkillInstallRequest {
  catalogId: string;
  name: string;
  source: string;
  scope: SkillInstallScope;
  targets: SkillTarget[];
  projectPath?: string;
  allowOverwriteModified?: boolean;
}

export interface InstalledSkillRecord {
  id: string;
  catalogId: string;
  name: string;
  source: string;
  sourceRevision: string;
  contentHash: string;
  scope: StoredSkillInstallScope;
  targets: StoredSkillTarget[];
  projectPath?: string;
  installPaths: string[];
  installedAt: string;
  /** External Skills are discoverable but never modified by PccAgent. */
  managed?: boolean;
  origin?: "PccAgent" | "Claude Code" | "Codex" | "Local Agent";
}

export type McpCatalogInstallKind = "remote" | "npm";
export type McpCatalogTransport = "http" | "sse" | "stdio";

export interface McpCatalogInput {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  secret: boolean;
  defaultValue?: string;
  target: "url" | "header" | "env" | "arg";
  argumentType?: "named" | "positional";
  argumentName?: string;
}

export interface McpCatalogInstallOption {
  id: string;
  kind: McpCatalogInstallKind;
  transport: McpCatalogTransport;
  label: string;
  supported: boolean;
  urlTemplate?: string;
  packageName?: string;
  packageVersion?: string;
  inputs: McpCatalogInput[];
}

export interface McpCatalogItem {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  iconUrl?: string;
  repositoryUrl?: string;
  installOptions: McpCatalogInstallOption[];
}

export interface McpCatalogInstallRequest {
  item: McpCatalogItem;
  optionId: string;
  values: Record<string, string>;
}

export interface InstalledMcpRecord {
  server: {
    name: string;
    transport: "stdio" | "sse" | "http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
  source: "PccAgent" | "Claude Code" | "Codex" | "Local MCP";
  managed: boolean;
}

export interface McpCatalogInstallResult {
  ok: boolean;
  server?: {
    name: string;
    transport: "stdio" | "sse" | "http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
  error?: string;
}
