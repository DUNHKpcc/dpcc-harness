/**
 * MCP server configuration builder shared between Electron and CLI.
 *
 * Electron passes a `getAuthHeaders` callback for OAuth support.
 * CLI passes undefined (no OAuth in CLI v1).
 */

export interface McpServerInput {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface BuildMcpConfigOptions {
  getAuthHeaders?: (serverName: string, url: string) => Promise<Record<string, string>>;
  /** Optional logger for diagnostic warnings (e.g. servers with missing URLs). */
  onWarn?: (label: string, message: string) => void;
  /** Test seam for platform-specific stdio normalization. Defaults to process.platform. */
  platform?: string;
}

export interface NormalizeMcpStdioOptions {
  platform?: string;
}

function currentPlatform(): string | undefined {
  return typeof process !== "undefined" ? process.platform : undefined;
}

function commandBasename(command: string | undefined): string {
  return (command ?? "").split(/[\\/]/).pop() ?? "";
}

function siblingCommand(command: string, nextName: string): string {
  const separatorIndex = Math.max(command.lastIndexOf("/"), command.lastIndexOf("\\"));
  if (separatorIndex < 0) return nextName;
  return `${command.slice(0, separatorIndex + 1)}${nextName}`;
}

function hasAssumeYesFlag(args: string[]): boolean {
  return args.some((arg) => arg === "-y" || arg === "--yes");
}

/**
 * Normalize stdio MCP launchers that are known to surface confusing macOS Dock
 * entries. `npm exec ...` can appear as a bouncing `exec` app while MCP starts;
 * `npx --yes ...` reaches the same npm package runner without that wrapper name.
 */
export function normalizeMcpStdioServer(
  server: McpServerInput,
  options?: NormalizeMcpStdioOptions,
): McpServerInput {
  if (server.transport !== "stdio") return server;
  if ((options?.platform ?? currentPlatform()) !== "darwin") return server;

  const command = server.command;
  const args = server.args ?? [];
  if (!command || args[0] !== "exec") return server;

  const base = commandBasename(command);
  if (base !== "npm") return server;

  const nextArgs = args.slice(1);
  return {
    ...server,
    command: siblingCommand(command, "npx"),
    args: hasAssumeYesFlag(nextArgs) ? nextArgs : ["--yes", ...nextArgs],
  };
}

/**
 * Build SDK-compatible MCP config from server configs.
 * Returns a record keyed by server name.
 */
export async function buildSdkMcpConfig(
  servers: McpServerInput[],
  options?: BuildMcpConfigOptions,
): Promise<Record<string, unknown>> {
  const sdkMcp: Record<string, unknown> = {};

  for (const s of servers) {
    const server = normalizeMcpStdioServer(s, { platform: options?.platform });
    if (server.transport === "stdio") {
      sdkMcp[server.name] = { command: server.command, args: server.args, env: server.env };
    } else if (server.url) {
      let headers = server.headers && Object.keys(server.headers).length > 0 ? { ...server.headers } : undefined;

      if (options?.getAuthHeaders) {
        try {
          const authHeaders = await options.getAuthHeaders(server.name, server.url);
          if (Object.keys(authHeaders).length > 0) {
            headers = { ...headers, ...authHeaders };
          }
        } catch {
          // OAuth not available — proceed without auth headers
        }
      }

      sdkMcp[server.name] = {
        type: server.transport,
        url: server.url,
        headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
      };
    } else {
      options?.onWarn?.("MCP_CONFIG_WARN", `Server "${server.name}" has transport "${server.transport}" but no URL — skipping`);
    }
  }
  return sdkMcp;
}

/**
 * Synchronous version for when no auth headers are needed (CLI).
 */
export function buildSdkMcpConfigSync(
  servers: McpServerInput[],
  options?: NormalizeMcpStdioOptions,
): Record<string, unknown> {
  const sdkMcp: Record<string, unknown> = {};

  for (const s of servers) {
    const server = normalizeMcpStdioServer(s, options);
    if (server.transport === "stdio") {
      sdkMcp[server.name] = { command: server.command, args: server.args, env: server.env };
    } else if (server.url) {
      sdkMcp[server.name] = {
        type: server.transport,
        url: server.url,
        headers: server.headers && Object.keys(server.headers).length > 0 ? server.headers : undefined,
      };
    }
  }
  return sdkMcp;
}
