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

export type SkillInstallScope = "project" | "global";
export type SkillTarget = "claude-code" | "codex";

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
  scope: SkillInstallScope;
  targets: SkillTarget[];
  projectPath?: string;
  installPaths: string[];
  installedAt: string;
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
  projectId: string;
  item: McpCatalogItem;
  optionId: string;
  values: Record<string, string>;
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
