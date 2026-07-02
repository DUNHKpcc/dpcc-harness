/**
 * PccAgent owns MCP configuration through its project MCP store. Claude Code's
 * user/local settings may enable additional MCP servers that spawn helper
 * processes outside the app's control, so SDK sessions must opt into strict MCP
 * config and only use the servers PccAgent passes explicitly.
 */
export function applyClaudeMcpIsolation(options: Record<string, unknown>): void {
  options.strictMcpConfig = true;
}
