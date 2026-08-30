import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServerConfig } from "./mcp-store";

export interface LocalMcpRecord {
  server: McpServerConfig;
  source: "PccAgent" | "Claude Code" | "Codex" | "Local MCP";
  managed: boolean;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeServer(name: string, value: unknown): McpServerConfig | null {
  if (!name.trim() || !isRecord(value)) return null;
  const command = typeof value.command === "string" ? value.command : undefined;
  const url = typeof value.url === "string" ? value.url : undefined;
  if (!command && !url) return null;
  const transport = value.transport === "sse" || value.transport === "http"
    ? value.transport
    : url ? "http" : "stdio";
  return {
    name: name.trim(),
    transport,
    ...(command ? { command } : {}),
    ...(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string") ? { args: value.args } : {}),
    ...(url ? { url } : {}),
  };
}

function readJsonServers(filePath: string): McpServerConfig[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return [];
    return Object.entries(parsed.mcpServers)
      .map(([name, server]) => normalizeServer(name, server))
      .filter((server): server is McpServerConfig => server !== null);
  } catch {
    return [];
  }
}

function parseTomlValue(value: string): string | string[] | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readCodexServers(filePath: string): McpServerConfig[] {
  try {
    const sections = new Map<string, JsonRecord>();
    let current: JsonRecord | null = null;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const heading = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
      if (heading) {
        const name = heading[1].replace(/^"|"$/g, "");
        current = {};
        sections.set(name, current);
        continue;
      }
      const field = line.match(/^(command|args|url)\s*=\s*(.+)$/);
      if (!field || !current) continue;
      const value = parseTomlValue(field[2]);
      if (value !== undefined) current[field[1]] = value;
    }
    return [...sections.entries()]
      .map(([name, server]) => normalizeServer(name, server))
      .filter((server): server is McpServerConfig => server !== null);
  } catch {
    return [];
  }
}

export function discoverLocalMcpServers(managedServers: McpServerConfig[]): LocalMcpRecord[] {
  const home = os.homedir();
  const sources: Array<{ source: LocalMcpRecord["source"]; servers: McpServerConfig[] }> = [
    { source: "Local MCP", servers: readJsonServers(path.join(home, ".mcp.json")) },
    { source: "Claude Code", servers: readJsonServers(path.join(home, ".claude.json")) },
    { source: "Codex", servers: readCodexServers(path.join(home, ".codex", "config.toml")) },
  ];
  const seen = new Set<string>();
  const records: LocalMcpRecord[] = [];
  for (const server of managedServers) {
    seen.add(server.name);
    records.push({ server, source: "PccAgent", managed: true });
  }
  for (const { source, servers } of sources) {
    for (const server of servers) {
      if (seen.has(server.name)) continue;
      seen.add(server.name);
      records.push({ server, source, managed: false });
    }
  }
  return records;
}
