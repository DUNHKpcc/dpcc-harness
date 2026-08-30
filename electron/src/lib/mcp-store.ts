import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./data-dir";
import { JsonFileStore } from "./json-file-store";

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

const store = new JsonFileStore<McpServerConfig[]>({
  subDir: "mcp",
  label: "MCP_STORE",
});
const migrationStore = new JsonFileStore<{ done: true }>({
  subDir: "mcp",
  label: "MCP_STORE_MIGRATION",
});

const GLOBAL_MCP_KEY = "global";
const GLOBAL_MCP_MIGRATION_KEY = "globalized-v1";

function isMcpServerArray(value: unknown): value is McpServerConfig[] {
  return Array.isArray(value) && value.every((server) => (
    typeof server === "object"
    && server !== null
    && typeof (server as McpServerConfig).name === "string"
    && typeof (server as McpServerConfig).transport === "string"
  ));
}

function loadLegacyProjectServers(): McpServerConfig[] {
  const directory = path.join(getDataDir(), "mcp");
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== `${GLOBAL_MCP_KEY}.json`)
      .flatMap((entry) => {
        try {
          const value: unknown = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8"));
          return isMcpServerArray(value) ? value : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Merge legacy project records once, retaining their source files for rollback safety. */
function migrateLegacyProjectServers(): McpServerConfig[] {
  const global = store.load(GLOBAL_MCP_KEY) ?? [];
  if (migrationStore.load(GLOBAL_MCP_MIGRATION_KEY)?.done) return global;
  const merged = [...global];
  for (const server of loadLegacyProjectServers()) {
    if (!merged.some((current) => current.name === server.name)) merged.push(server);
  }
  if (merged.length !== global.length) store.save(GLOBAL_MCP_KEY, merged);
  migrationStore.save(GLOBAL_MCP_MIGRATION_KEY, { done: true });
  return merged;
}

export function loadMcpServers(): McpServerConfig[] {
  return migrateLegacyProjectServers();
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  store.save(GLOBAL_MCP_KEY, servers);
}

export function addMcpServer(server: McpServerConfig): void {
  const servers = loadMcpServers();
  const idx = servers.findIndex((s) => s.name === server.name);
  if (idx >= 0) servers[idx] = server;
  else servers.push(server);
  saveMcpServers(servers);
}

export function removeMcpServer(name: string): void {
  const servers = loadMcpServers().filter((server) => server.name !== name);
  saveMcpServers(servers);
}
