import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BUILTIN_PI_AGENT, BUILTIN_PI_AGENT_ID } from "@/types";
import type { EngineId, InstalledAgent } from "@/types";
import { AgentIcon } from "@/components/AgentIcon";
import { getAgentIcon } from "@/lib/engine-icons";
import { TOOLBAR_BTN } from "./constants";

interface AgentPickerDropdownProps {
  isProcessing: boolean;
  selectedAgent: InstalledAgent | null;
  agents: InstalledAgent[];
  onAgentChange: (agent: InstalledAgent | null) => void;
  lockedEngine?: EngineId | null;
  lockedAgentId?: string | null;
  onManageACPs?: () => void;
}

/** Selects an engine or ACP agent. Model configuration lives in a separate menu. */
export const EnginePickerDropdown = memo(function EnginePickerDropdown({
  isProcessing,
  selectedAgent,
  agents,
  onAgentChange,
  lockedEngine,
  lockedAgentId,
  onManageACPs,
}: AgentPickerDropdownProps) {
  const { t } = useTranslation("input");
  const currentAgentId = selectedAgent?.id ?? BUILTIN_PI_AGENT_ID;

  const willOpenNewChat = (agent: InstalledAgent) => {
    if (lockedEngine == null) return false;
    if (agent.engine !== lockedEngine) return true;
    return lockedEngine === "acp"
      && !!lockedAgentId
      && agent.id !== lockedAgentId;
  };

  const renderAgent = (agent: InstalledAgent) => {
    const isCurrent = currentAgentId === agent.id;
    const isCrossEngine = willOpenNewChat(agent);

    return (
      <DropdownMenuItem
        key={agent.id}
        onClick={() => onAgentChange(agent)}
        className={isCurrent ? "bg-accent" : ""}
      >
        <AgentIcon icon={getAgentIcon(agent)} size={16} className="shrink-0" />
        <div className="min-w-0">
          <div className="truncate">{agent.name}</div>
          {isCrossEngine && (
            <div className="text-[10px] text-muted-foreground/70">
              {t("engine.opensNewChat")}
            </div>
          )}
        </div>
      </DropdownMenuItem>
    );
  };

  const firstPartyAgents = agents.filter((agent) => agent.engine === "acp" && agent.builtIn);
  const acpAgents = agents.filter((agent) => agent.engine === "acp" && !agent.builtIn);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={TOOLBAR_BTN}
          disabled={isProcessing}
        >
          <AgentIcon
            icon={getAgentIcon(selectedAgent ?? BUILTIN_PI_AGENT)}
            size={14}
            className="shrink-0"
          />
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {firstPartyAgents.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground">
              {t("engine.engines")}
            </DropdownMenuLabel>
            {firstPartyAgents.map(renderAgent)}
          </DropdownMenuGroup>
        )}
        {acpAgents.length > 0 && (
          <>
            {firstPartyAgents.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground">
                {t("engine.acpAgents")}
              </DropdownMenuLabel>
              {acpAgents.map(renderAgent)}
            </DropdownMenuGroup>
          </>
        )}
        {onManageACPs && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManageACPs}>
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              {t("engine.manageACPs")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
