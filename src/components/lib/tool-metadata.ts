import type { TFunction } from "i18next";
import {
  Terminal,
  FileText,
  FileEdit,
  Search,
  FolderSearch,
  Globe,
  Bot,
  Wrench,
  ListChecks,
  Lightbulb,
  Map,
  MessageCircleQuestion,
  PackageSearch,
  Sparkles,
} from "lucide-react";

// ── Tool icons ──

export const TOOL_ICONS: Record<string, typeof Terminal> = {
  Bash: Terminal,
  Read: FileText,
  Write: FileEdit,
  Edit: FileEdit,
  Grep: Search,
  Glob: FolderSearch,
  WebSearch: Globe,
  WebFetch: Globe,
  Task: Bot,
  Think: Lightbulb,
  TodoWrite: ListChecks,
  EnterPlanMode: Lightbulb,
  ExitPlanMode: Map,
  AskUserQuestion: MessageCircleQuestion,
  ToolSearch: PackageSearch,
  Skill: Sparkles,
};

export function getToolIcon(toolName: string) {
  return TOOL_ICONS[toolName] ?? Wrench;
}

// ── Tool labels ──

export type ToolLabelType = "past" | "active" | "failure";

/** Native tool identifiers that have a localized label set under `label.<id>`. */
const NATIVE_LABEL_TOOLS = new Set([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "Think",
  "EnterPlanMode",
  "ExitPlanMode",
  "AskUserQuestion",
  "ToolSearch",
  "Skill",
]);

// MCP tool friendly names — pattern-matched for different server name prefixes.
// Each entry maps to a `mcpLabel.<key>` translation key.
export const MCP_TOOL_LABELS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /searchJiraIssuesUsingJql$/, key: "searchJira" },
  { pattern: /getJiraIssue$/, key: "fetchIssue" },
  { pattern: /getVisibleJiraProjects$/, key: "listProjects" },
  { pattern: /createJiraIssue$/, key: "createIssue" },
  { pattern: /editJiraIssue$/, key: "updateIssue" },
  { pattern: /transitionJiraIssue$/, key: "transitionIssue" },
  { pattern: /addCommentToJiraIssue$/, key: "addComment" },
  { pattern: /getTransitionsForJiraIssue$/, key: "getTransitions" },
  { pattern: /lookupJiraAccountId$/, key: "lookupUser" },
  { pattern: /getConfluencePage$/, key: "fetchPage" },
  { pattern: /searchConfluenceUsingCql$/, key: "searchConfluence" },
  { pattern: /getConfluenceSpaces$/, key: "listSpaces" },
  { pattern: /getConfluencePageDescendants$/, key: "listDescendants" },
  { pattern: /getPagesInConfluenceSpace$/, key: "listPages" },
  { pattern: /createConfluencePage$/, key: "createPage" },
  { pattern: /updateConfluencePage$/, key: "updatePage" },
  { pattern: /getAccessibleAtlassianResources$/, key: "getResources" },
  { pattern: /atlassianUserInfo$/, key: "getUserInfo" },
  { pattern: /Atlassian[/_]+search$/, key: "searchAtlassian" },
  { pattern: /Atlassian[/_]+fetch$/, key: "fetchResource" },
  // Context7
  { pattern: /resolve-library-id$/, key: "resolveLibrary" },
  { pattern: /query-docs$/, key: "queryDocs" },
];

export function getMcpToolLabel(toolName: string, type: ToolLabelType, t: TFunction<"toolcall">): string | null {
  for (const { pattern, key } of MCP_TOOL_LABELS) {
    if (pattern.test(toolName)) return t(`mcpLabel.${key}.${type}`);
  }
  // Generic fallback for any MCP tool (mcp__Server__tool) or ACP tool (Tool: Server/tool)
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    const server = parts[1] ?? "MCP";
    return t(`mcpGeneric.${type}`, { server });
  }
  if (toolName.startsWith("Tool: ")) {
    const server = toolName.slice(6).split("/")[0] ?? "MCP";
    return t(`mcpGeneric.${type}`, { server });
  }
  return null;
}

export function getToolLabel(toolName: string, type: ToolLabelType, t: TFunction<"toolcall">): string | null {
  if (!toolName) return type === "failure" ? t("fallback.runTool") : null;

  if (NATIVE_LABEL_TOOLS.has(toolName)) return t(`label.${toolName}.${type}`);

  const mcp = getMcpToolLabel(toolName, type, t);
  if (mcp) return mcp;

  return type === "failure" ? t("fallback.runNamed", { name: toolName.toLowerCase() }) : null;
}

// ── Tool colors ──

export const TOOL_COLORS: Record<string, string> = {
  Bash: "text-[#6ee7b7]",
  Read: "text-[#67e8f9]",
  Write: "text-[#fb923c]",
  Edit: "text-[#fb923c]",
  NotebookEdit: "text-[#fb923c]",
  Grep: "text-[#a78bfa]",
  Glob: "text-[#a78bfa]",
  WebSearch: "text-[#22d3ee]",
  WebFetch: "text-[#22d3ee]",
  Task: "text-[#38bdf8]",
  Think: "text-[#fde68a]",
  TodoWrite: "text-[#34d399]",
  Skill: "text-[#f0abfc]",
  ToolSearch: "text-[#818cf8]",
};

export function getToolColor(toolName: string): string {
  return TOOL_COLORS[toolName] ?? "text-foreground/40";
}
