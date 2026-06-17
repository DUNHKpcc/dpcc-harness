import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Loader2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  InstalledAgent,
  ACPConfigOption,
  ClaudeEffort,
  EngineId,
} from "@/types";
import { flattenConfigOptions } from "@/lib/engine/acp-utils";
import { AgentIcon } from "@/components/AgentIcon";
import { ENGINE_ICONS, getAgentIcon } from "@/lib/engine-icons";
import { TOOLBAR_BTN } from "./constants";

// ── Effort level descriptions ──

const KNOWN_CLAUDE_EFFORTS = new Set(["low", "medium", "high", "max"]);

// ── Derived model/effort state ──

interface ModelItem {
  id: string;
  label: string;
  description: string;
}

export interface EnginePickerDropdownProps {
  isProcessing: boolean;
  isACPAgent: boolean;
  isCodexAgent: boolean;
  selectedAgent: InstalledAgent | null;
  agents: InstalledAgent[];
  onAgentChange: (agent: InstalledAgent | null) => void;
  // Model state
  selectedModelId: string;
  selectedModelLabel: string;
  modelList: ModelItem[];
  modelsLoading: boolean;
  modelsLoadingText: string;
  onModelChange: (model: string) => void;
  // Claude effort
  claudeEffortOptions: string[];
  claudeActiveEffort: ClaudeEffort;
  onClaudeModelEffortChange: (model: string, effort: ClaudeEffort) => void;
  // Codex effort
  codexEffortOptions: Array<{ reasoningEffort: string; description: string }>;
  codexActiveEffort: string;
  onCodexEffortChange?: (effort: string) => void;
  // ACP config
  showACPConfigOptions: boolean;
  acpConfigOptions?: ACPConfigOption[];
  acpConfigOptionsLoading?: boolean;
  onACPConfigChange?: (configId: string, value: string) => void;
  // Session locking
  lockedEngine?: EngineId | null;
  lockedAgentId?: string | null;
  // Navigation
  onManageACPs?: () => void;
  // Trigger styling: "icon" renders agent icon only (default, sits inside the
  // input capsule); "label" renders the model name + effort label (sits in the
  // sunken row below the capsule).
  triggerMode?: "icon" | "label";
}

/** Engine/model/effort/agent picker dropdown in the input bar toolbar. */
export const EnginePickerDropdown = memo(function EnginePickerDropdown({
  isProcessing,
  isACPAgent,
  isCodexAgent,
  selectedAgent,
  agents,
  onAgentChange,
  selectedModelId,
  selectedModelLabel,
  modelList,
  modelsLoading,
  modelsLoadingText,
  onModelChange,
  claudeEffortOptions,
  claudeActiveEffort,
  onClaudeModelEffortChange,
  codexEffortOptions,
  codexActiveEffort,
  onCodexEffortChange,
  showACPConfigOptions,
  acpConfigOptions,
  acpConfigOptionsLoading,
  onACPConfigChange,
  lockedEngine,
  lockedAgentId,
  onManageACPs,
  triggerMode = "icon",
}: EnginePickerDropdownProps) {
  const { t } = useTranslation("input");
  // Engine-specific config items (model/effort/ACP config) -- shared between
  // multi-agent submenu and single-agent direct rendering
  const configItems = (
    <>
      {/* Model list (Claude + Codex) */}
      {!isACPAgent &&
        !modelsLoading &&
        modelList.length > 0 &&
        modelList.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => onModelChange(m.id)}
            className={m.id === selectedModelId ? "bg-accent" : ""}
          >
            <div>
              <div>{m.label}</div>
              {m.description && (
                <div className="text-[10px] text-muted-foreground">
                  {m.description}
                </div>
              )}
            </div>
          </DropdownMenuItem>
        ))}

      {/* Claude effort for current model */}
      {!isCodexAgent && !isACPAgent && claudeEffortOptions.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
            {t("engine.effort")}
          </div>
          {claudeEffortOptions.map((effort) => (
            <DropdownMenuItem
              key={effort}
              onClick={() =>
                onClaudeModelEffortChange(
                  selectedModelId,
                  effort as ClaudeEffort,
                )
              }
              className={effort === claudeActiveEffort ? "bg-accent" : ""}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="capitalize">{effort}</span>
                  {effort === claudeActiveEffort && (
                    <span className="text-[10px] text-muted-foreground">
                      {t("engine.current")}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {KNOWN_CLAUDE_EFFORTS.has(effort)
                    ? t(`engine.effortDesc.${effort}`)
                    : t("engine.customReasoningEffort")}
                </div>
              </div>
            </DropdownMenuItem>
          ))}
        </>
      )}

      {/* Models loading */}
      {!isACPAgent && modelsLoading && (
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {modelsLoadingText}
        </DropdownMenuItem>
      )}

      {/* Codex effort */}
      {isCodexAgent &&
        codexEffortOptions.length > 0 &&
        onCodexEffortChange && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
              {t("engine.effort")}
            </div>
            {codexEffortOptions.map((opt) => (
              <DropdownMenuItem
                key={opt.reasoningEffort}
                onClick={() => onCodexEffortChange(opt.reasoningEffort)}
                className={
                  opt.reasoningEffort === codexActiveEffort ? "bg-accent" : ""
                }
              >
                <div>
                  <div className="capitalize">{opt.reasoningEffort}</div>
                  {opt.description && (
                    <div className="text-[10px] text-muted-foreground">
                      {opt.description}
                    </div>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </>
        )}

      {/* ACP config options */}
      {isACPAgent &&
        showACPConfigOptions &&
        acpConfigOptions &&
        acpConfigOptions.length > 0 &&
        onACPConfigChange &&
        acpConfigOptions.map((opt) => {
          const flat = flattenConfigOptions(opt.options);
          const current = flat.find((o) => o.value === opt.currentValue);
          return (
            <DropdownMenuSub key={opt.id}>
              <DropdownMenuSubTrigger>
                <div>
                  <div>{opt.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {current?.name ?? opt.currentValue}
                  </div>
                </div>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {flat.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onClick={() => onACPConfigChange(opt.id, o.value)}
                    className={
                      o.value === opt.currentValue ? "bg-accent" : ""
                    }
                  >
                    <div>
                      <div>{o.name}</div>
                      {o.description && (
                        <div className="text-[10px] text-muted-foreground">
                          {o.description}
                        </div>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}

      {/* ACP config loading */}
      {isACPAgent && acpConfigOptionsLoading && !showACPConfigOptions && (
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("engine.loadingOptions")}
        </DropdownMenuItem>
      )}

      {/* ACP no config options available */}
      {isACPAgent && !acpConfigOptionsLoading && !showACPConfigOptions && (
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          {t("engine.noOptions")}
        </DropdownMenuItem>
      )}
    </>
  );

  // ── Trigger button content ──

  const triggerContent = triggerMode === "icon" ? (
    <>
      <AgentIcon
        icon={selectedAgent ? getAgentIcon(selectedAgent) : ENGINE_ICONS.claude}
        size={14}
        className="shrink-0"
      />
      {!isACPAgent && modelsLoading && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
      )}
      {isACPAgent && acpConfigOptionsLoading && !showACPConfigOptions && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
      )}
      <ChevronDown className="size-3" />
    </>
  ) : (
    <>
      {!isACPAgent && !modelsLoading && selectedModelLabel && (
        <span>{selectedModelLabel}</span>
      )}
      {!isACPAgent && !isCodexAgent && !modelsLoading && KNOWN_CLAUDE_EFFORTS.has(claudeActiveEffort) && (
        <span className="text-muted-foreground/70">· {claudeActiveEffort}</span>
      )}
      {isCodexAgent && !modelsLoading && codexActiveEffort && (
        <span className="text-muted-foreground/70">· {codexActiveEffort}</span>
      )}
      {!isACPAgent && modelsLoading && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
      )}
      {isACPAgent &&
        showACPConfigOptions &&
        acpConfigOptions &&
        acpConfigOptions.length > 0 &&
        (() => {
          const first = acpConfigOptions[0];
          const flat = flattenConfigOptions(first.options);
          const current = flat.find((o) => o.value === first.currentValue);
          return (
            <span>{current?.name ?? first.currentValue}</span>
          );
        })()}
      {isACPAgent && acpConfigOptionsLoading && !showACPConfigOptions && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
      )}
      <ChevronDown className="size-3" />
    </>
  );

  // ── Dropdown content: single-agent vs multi-agent ──

  const hasMultipleAgents = agents.length > 1;

  const willOpenNewChat = (agent: InstalledAgent) => {
    if (lockedEngine == null) return false;
    if (agent.engine !== lockedEngine) return true;
    if (
      lockedEngine === "acp" &&
      lockedAgentId &&
      agent.id !== lockedAgentId
    )
      return true;
    return false;
  };

  const renderAgent = (agent: InstalledAgent, isCrossEngine: boolean) => {
    const isCurrent = (selectedAgent?.id ?? "claude-code") === agent.id;

    const agentLabel = (
      <>
        <AgentIcon icon={getAgentIcon(agent)} size={16} className="shrink-0" />
        <div>
          <div className="flex items-center gap-1.5">
            {agent.name}
          </div>
          {isCrossEngine && (
            <div className="text-[10px] text-muted-foreground/70">
              {t("engine.opensNewChat")}
            </div>
          )}
        </div>
      </>
    );

    if (isCurrent) {
      return (
        <DropdownMenuSub key={agent.id}>
          <DropdownMenuSubTrigger className="bg-accent">
            {agentLabel}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {configItems}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }

    return (
      <DropdownMenuItem
        key={agent.id}
        onClick={() =>
          onAgentChange(agent.engine === "claude" ? null : agent)
        }
      >
        {agentLabel}
      </DropdownMenuItem>
    );
  };

  // Split agents into first-party engines (claude, codex) vs ACP agents
  const firstPartyAgents = hasMultipleAgents
    ? agents.filter((a) => a.engine === "claude" || a.engine === "codex")
    : [];
  const acpAgents = hasMultipleAgents
    ? agents.filter((a) => a.engine === "acp")
    : [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={TOOLBAR_BTN}
          disabled={isProcessing}
        >
          {triggerContent}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {hasMultipleAgents ? (
          <>
            {firstPartyAgents.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground">
                  {t("engine.engines")}
                </DropdownMenuLabel>
                {firstPartyAgents.map((a) => renderAgent(a, willOpenNewChat(a)))}
              </DropdownMenuGroup>
            )}
            {acpAgents.length > 0 && (
              <>
                {firstPartyAgents.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground">
                    {t("engine.acpAgents")}
                  </DropdownMenuLabel>
                  {acpAgents.map((a) => renderAgent(a, willOpenNewChat(a)))}
                </DropdownMenuGroup>
              </>
            )}
          </>
        ) : (
          configItems
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
