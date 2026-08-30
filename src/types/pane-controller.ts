/**
 * Shared types for the pane controller pattern.
 *
 * A PaneController encapsulates all model/permission/send/stop
 * callbacks for a single chat pane — used identically by both
 * the single-chat view and each split-view pane.
 */

import type { ACPConfigOption, FileReference, ImageAttachment, SlashCommand, EngineId, InstalledAgent, McpServerConfig, McpServerStatus, GrabbedElement } from "@/types";
import type { TerminalTab } from "@/lib/terminal-tabs";
import type { ResolvedTheme } from "@/hooks/useTheme";

export interface PaneController {
  paneEngine: EngineId;
  selectedPaneAgent: InstalledAgent | null;
  paneModel: string;
  paneHeaderModel: string;
  panePermissionMode: string;
  panePlanMode: boolean;
  paneSlashCommands: SlashCommand[];
  paneAcpConfigOptions: ACPConfigOption[];
  paneAcpConfigOptionsLoading: boolean;
  handlePaneAgentChange: (agent: InstalledAgent | null) => Promise<void>;
  handlePaneClear: () => Promise<void>;
  handlePaneSend: (text: string, images?: ImageAttachment[], displayText?: string, fileReferences?: FileReference[]) => Promise<void>;
  handlePaneStop: () => Promise<void>;
  handlePaneAcpConfigChange: (key: string, value: string) => void;
}

/**
 * Props shared by ToolIslandContent across all three render sites.
 * These come from the space/terminal/mcp context and don't change per-island.
 */
export interface ToolIslandContextProps {
  spaceId: string;
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  terminalsReady: boolean;
  onSetActiveTab: (tabId: string | null) => void;
  onCreateTerminal: () => Promise<void>;
  onEnsureTerminal: () => Promise<void>;
  onCloseTerminal: (tabId: string) => Promise<void>;
  resolvedTheme: ResolvedTheme;
  onElementGrab?: (element: GrabbedElement) => void;
  collapsedRepos: Set<string>;
  onToggleRepoCollapsed: (path: string) => void;
  mcpServerStatuses: McpServerStatus[];
  mcpStatusPreliminary: boolean;
  onRefreshMcpStatus: () => void;
  onReconnectMcpServer: (name: string) => Promise<void> | void;
  onRestartWithMcpServers: (servers: McpServerConfig[]) => Promise<void> | void;
}
