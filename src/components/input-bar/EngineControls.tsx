import { Bot, ChevronDown, Map, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AcpPermissionBehavior } from "@/types";
import {
  TOOLBAR_BTN,
  ACP_PERMISSION_BEHAVIORS,
  PERMISSION_MODES,
  CODEX_PERMISSION_MODE_DETAILS,
} from "./constants";

// ── Sub-components ──

/** Permission mode dropdown -- used by Claude and Codex engines */
export function PermissionDropdown({
  permissionMode,
  onPermissionModeChange,
  showDetails,
  disabled,
}: {
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  /** When true, shows policy + description (Codex style) */
  showDetails?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation("input");
  const selectedMode =
    PERMISSION_MODES.find((m) => m.id === permissionMode) ??
    PERMISSION_MODES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={TOOLBAR_BTN}
          disabled={disabled}
        >
          <Shield className="size-3" />
          {t(`control.permissionMode.${selectedMode.id}`)}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PERMISSION_MODES.map((m) => {
          const details = showDetails
            ? CODEX_PERMISSION_MODE_DETAILS[m.id]
            : undefined;
          const label = t(`control.permissionMode.${m.id}`);
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onPermissionModeChange(m.id)}
              className={m.id === permissionMode ? "bg-accent" : ""}
            >
              {details ? (
                <div className="flex min-w-0 flex-col">
                  <span>{label}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="font-mono text-foreground/80">
                      {details.policy}
                    </span>
                    <span aria-hidden="true">&middot;</span>
                    <span>{t(`control.codexPermissionDesc.${m.id}`)}</span>
                  </span>
                </div>
              ) : (
                label
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Plan mode toggle button -- used by Claude and Codex engines */
function PlanModeToggle({
  planMode,
  onPlanModeChange,
  disabled,
}: {
  planMode: boolean;
  onPlanModeChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("input");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => onPlanModeChange(!planMode)}
          className={`rounded-lg font-normal ${
            planMode
              ? "text-blue-400 bg-blue-500/10 hover:bg-blue-500/15 hover:text-blue-400 dark:hover:bg-blue-500/15"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <Map className="size-3" />
          {t("control.plan")}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">
          {planMode ? t("control.planModeOn") : t("control.planModeOff")} (Shift+Tab)
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Main component ──

export interface EngineControlsProps {
  isCodexAgent: boolean;
  isACPAgent: boolean;
  isProcessing: boolean;
  disabled?: boolean;
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  planMode: boolean;
  onPlanModeChange: (enabled: boolean) => void;
  acpPermissionBehavior?: AcpPermissionBehavior;
  onAcpPermissionBehaviorChange?: (behavior: AcpPermissionBehavior) => void;
  /** Claude-only: whether Claude may delegate to a visible Codex split pane. */
  claudeCodexBridgeEnabled?: boolean;
  onClaudeCodexBridgeEnabledChange?: (enabled: boolean) => void;
}

/** Claude-only toggle that lets Claude delegate to a visible Codex split pane. */
function CodexBridgeToggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("input");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => onChange(!enabled)}
          className={`rounded-lg font-normal ${
            enabled
              ? "text-teal-400 bg-teal-500/10 hover:bg-teal-500/15 hover:text-teal-400 dark:hover:bg-teal-500/15"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <Bot className="size-3" />
          {t("control.codex")}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">
          {enabled ? t("control.codexBridgeOn") : t("control.codexBridgeOff")}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/** ACP permission behavior dropdown -- used by ACP agents */
export function AcpBehaviorDropdown({
  acpPermissionBehavior,
  onAcpPermissionBehaviorChange,
  disabled,
}: {
  acpPermissionBehavior: AcpPermissionBehavior | undefined;
  onAcpPermissionBehaviorChange: (behavior: AcpPermissionBehavior) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("input");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={TOOLBAR_BTN}
          disabled={disabled}
        >
          <Shield className="size-3" />
          {t(
            `control.acpBehavior.${
              ACP_PERMISSION_BEHAVIORS.find(
                (b) => b.id === acpPermissionBehavior,
              )?.id ?? "ask"
            }`,
          )}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ACP_PERMISSION_BEHAVIORS.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => onAcpPermissionBehaviorChange(b.id)}
            className={b.id === acpPermissionBehavior ? "bg-accent" : ""}
          >
            <div>
              <div>{t(`control.acpBehavior.${b.id}`)}</div>
              <div className="text-[10px] text-muted-foreground">
                {t(`control.acpBehavior.${b.id}Desc`)}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Renders the in-capsule Plan toggle. Permission/ACP-behavior have been moved
 *  out into a sunken row below the capsule. */
export function EngineControls({
  isCodexAgent,
  isACPAgent,
  isProcessing,
  disabled,
  planMode,
  onPlanModeChange,
  claudeCodexBridgeEnabled,
  onClaudeCodexBridgeEnabledChange,
}: EngineControlsProps) {
  if (isACPAgent) return null;
  return (
    <>
      <PlanModeToggle
        planMode={planMode}
        onPlanModeChange={onPlanModeChange}
        disabled={disabled}
      />
      {!isCodexAgent && onClaudeCodexBridgeEnabledChange && (
        <CodexBridgeToggle
          enabled={claudeCodexBridgeEnabled === true}
          onChange={onClaudeCodexBridgeEnabledChange}
          disabled={disabled || isProcessing}
        />
      )}
    </>
  );
}
