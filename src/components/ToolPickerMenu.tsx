import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, ListTodo, Bot, PanelRight, SquareArrowOutUpRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PANEL_TOOLS_MAP } from "./ToolPicker";
import type { ToolId, ToolDef } from "@/types/tools";

const CONTEXTUAL_TOOLS: ToolDef[] = [
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "agents", label: "Background Agents", icon: Bot },
];

export const TOOL_PICKER_MENU_CONTENT_CLASS = "no-drag min-w-[180px]";

const TOOL_LABEL_KEYS: Record<string, string> = {
  terminal: "picker.terminal",
  browser: "picker.browser",
  git: "picker.git",
  files: "picker.files",
  "project-files": "picker.projectFiles",
  mcp: "picker.mcp",
  tasks: "picker.tasks",
  agents: "picker.agents",
};

interface ToolPickerMenuProps {
  activeTools: Set<ToolId>;
  onToggleTool: (toolId: ToolId) => void;
  availableContextual?: Set<ToolId>;
  toolOrder: ToolId[];
  projectPath?: string;
}

export const ToolPickerMenu = memo(function ToolPickerMenu({
  activeTools,
  onToggleTool,
  availableContextual,
  toolOrder,
  projectPath,
}: ToolPickerMenuProps) {
  const { t } = useTranslation("tools");

  const panelTools = useMemo(
    () => toolOrder
      .filter((id) => id in PANEL_TOOLS_MAP)
      .map((id) => {
        const tool = PANEL_TOOLS_MAP[id];
        const key = TOOL_LABEL_KEYS[tool.id];
        return key ? { ...tool, label: t(key) } : tool;
      }),
    [toolOrder, t],
  );

  const contextualTools = useMemo(
    () => CONTEXTUAL_TOOLS
      .filter((tool) => availableContextual?.has(tool.id))
      .map((tool) => {
        const key = TOOL_LABEL_KEYS[tool.id];
        const panelDef = PANEL_TOOLS_MAP[tool.id];
        return {
          ...tool,
          label: key ? t(key) : tool.label,
          icon: panelDef?.icon ?? tool.icon,
        };
      }),
    [availableContextual, t],
  );

  const handleOpenInEditor = useCallback(() => {
    if (projectPath) window.claude.openInEditor(projectPath);
  }, [projectPath]);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="no-drag h-6 w-6 text-muted-foreground/40 hover:text-foreground/60"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {t("picker.togglePanels")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={8} className={TOOL_PICKER_MENU_CONTENT_CLASS}>
        {contextualTools.length > 0 && (
          <>
            {contextualTools.map((tool) => {
              const isActive = activeTools.has(tool.id);
              const Icon = tool.icon;
              return (
                <DropdownMenuItem
                  key={tool.id}
                  onClick={() => onToggleTool(tool.id)}
                  className="gap-2.5"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{tool.label}</span>
                  {isActive && <Check className="h-3.5 w-3.5 text-foreground/60" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
          </>
        )}
        {panelTools.map((tool) => {
          const isActive = activeTools.has(tool.id);
          const Icon = tool.icon;
          return (
            <DropdownMenuItem
              key={tool.id}
              onClick={() => onToggleTool(tool.id)}
              className="gap-2.5"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">{tool.label}</span>
              {isActive && <Check className="h-3.5 w-3.5 text-foreground/60" />}
            </DropdownMenuItem>
          );
        })}
        {projectPath && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleOpenInEditor} className="gap-2.5">
              <SquareArrowOutUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">{t("picker.openInEditor")}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}, (prev, next) => {
  if (prev.onToggleTool !== next.onToggleTool) return false;
  if (prev.projectPath !== next.projectPath) return false;
  if (prev.toolOrder !== next.toolOrder) return false;
  if (prev.activeTools !== next.activeTools) {
    if (prev.activeTools.size !== next.activeTools.size) return false;
    for (const id of prev.activeTools) { if (!next.activeTools.has(id)) return false; }
  }
  const pc = prev.availableContextual;
  const nc = next.availableContextual;
  if (pc !== nc) {
    if (!pc || !nc || pc.size !== nc.size) return false;
    for (const id of pc) { if (!nc.has(id)) return false; }
  }
  return true;
});
