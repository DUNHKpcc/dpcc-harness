import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Info, Loader2, PanelLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isMac } from "@/lib/utils";
import type { AcpPermissionBehavior } from "@/types";

interface ChatHeaderProps {
  islandLayout: boolean;
  sidebarOpen: boolean;
  showSidebarToggle?: boolean;
  isProcessing: boolean;
  model?: string;
  sessionId?: string;
  totalCost: number;
  title?: string;
  titleGenerating?: boolean;
  planMode?: boolean;
  permissionMode?: string;
  acpPermissionBehavior?: AcpPermissionBehavior;
  onToggleSidebar: () => void;
  showDevFill?: boolean;
  onSeedDevExampleConversation?: () => void;
  onSeedDevExampleSpaceData?: () => void;
  /** Close this split pane (renders an X button on the right). */
  onClosePane?: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  islandLayout,
  sidebarOpen,
  showSidebarToggle = true,
  isProcessing,
  model,
  sessionId,
  totalCost,
  title,
  titleGenerating,
  planMode,
  permissionMode,
  acpPermissionBehavior,
  onToggleSidebar,
  showDevFill,
  onSeedDevExampleConversation,
  onSeedDevExampleSpaceData,
  onClosePane,
}: ChatHeaderProps) {
  const { t } = useTranslation("chat");
  const modeLabel = permissionMode
    ? t(`header.permissionMode.${permissionMode}`, { defaultValue: permissionMode })
    : null;
  const acpBehaviorLabel = acpPermissionBehavior
    ? t(`header.acpBehavior.${acpPermissionBehavior}`)
    : null;
  const permissionDisplay = acpBehaviorLabel ?? modeLabel;
  const macIslandTitlebarOffsetClass = islandLayout && isMac ? "translate-y-0.5" : "";
  const shouldShowSidebarToggle = showSidebarToggle && !sidebarOpen;
  const shouldReserveSidebarInset = shouldShowSidebarToggle && isMac;

  // Collect all session detail rows for the unified tooltip
  const detailRows: { label: string; value: string }[] = [];
  if (model) detailRows.push({ label: t("header.model"), value: model });
  detailRows.push({
    label: t("header.plan"),
    value: planMode ? t("state.on", { ns: "common" }) : t("state.off", { ns: "common" }),
  });
  if (permissionDisplay) detailRows.push({ label: t("header.permissions"), value: permissionDisplay });
  if (totalCost > 0) detailRows.push({ label: t("header.cost"), value: `$${totalCost.toFixed(4)}` });
  if (sessionId) detailRows.push({ label: t("header.session"), value: sessionId });

  const hasDetails = detailRows.length > 0;
  const showDevSeedButton = import.meta.env.DEV && !!showDevFill && !!onSeedDevExampleConversation;

  return (
    <div
      className={`chat-header pointer-events-auto drag-region flex items-center gap-3 ${
        islandLayout ? "h-8 px-3" : "h-[3.25rem] px-4"
      } ${
        shouldReserveSidebarInset ? (islandLayout ? "ps-[78px]" : "ps-[84px]") : ""
      }`}
    >
      {shouldShowSidebarToggle && (
        <Button
          variant="ghost"
          size="icon"
          className={`no-drag h-7 w-7 text-muted-foreground/60 hover:text-foreground ${
            islandLayout ? "mt-0.5" : ""
          } ${macIslandTitlebarOffsetClass}`}
          onClick={onToggleSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Processing spinner — left of title, hover shows runtime model + permission mode */}
      {isProcessing && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`no-drag flex items-center justify-center ${macIslandTitlebarOffsetClass}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </span>
          </TooltipTrigger>
          {(model || permissionDisplay) && (
            <TooltipContent side="bottom">
              <div className="space-y-0.5 text-xs">
                {model && (
                  <div className="flex justify-between gap-4">
                    <span className="opacity-70">{t("header.model")}</span>
                    <span className="font-mono">{model}</span>
                  </div>
                )}
                {permissionDisplay && (
                  <div className="flex justify-between gap-4">
                    <span className="opacity-70">{t("header.permissions")}</span>
                    <span className="font-mono">{permissionDisplay}</span>
                  </div>
                )}
              </div>
            </TooltipContent>
          )}
        </Tooltip>
      )}

      {titleGenerating ? (
        <span
          className={`no-drag inline-block h-4 w-36 animate-pulse rounded bg-foreground/10 ${
            islandLayout ? "relative top-px" : ""
          } ${macIslandTitlebarOffsetClass}`}
        />
      ) : title && title !== "New Chat" ? (
        <span
          className={`no-drag truncate leading-none text-sm font-medium text-foreground/80 ${
            islandLayout ? "relative top-px" : ""
          } ${macIslandTitlebarOffsetClass}`}
        >
          {title}
        </span>
      ) : null}

      {/* Session info, split view toggle, and pane close */}
      {(showDevSeedButton || hasDetails || onClosePane) && (
        <div className="ms-auto flex items-center gap-1.5">
          {onClosePane && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="no-drag h-6 w-6 text-muted-foreground/40 hover:text-foreground/60"
                  onClick={onClosePane}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {t("header.closePane")}
              </TooltipContent>
            </Tooltip>
          )}
          {showDevSeedButton && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="no-drag h-6 gap-1 px-2 text-[10px]"
                >
                  {t("header.devFill")}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onSeedDevExampleConversation}>
                  {t("header.fillCurrentChat")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onSeedDevExampleSpaceData}>
                  {t("header.fillCurrentSpace")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {hasDetails && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="no-drag flex cursor-default items-center justify-center rounded-full p-0.5 text-muted-foreground/30 transition-colors hover:text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end">
                <div className="space-y-1 text-xs">
                  {detailRows.map((row) => (
                    <div key={row.label} className="flex justify-between gap-6">
                      <span className="opacity-70">{row.label}</span>
                      <span className="font-mono text-end">{row.value}</span>
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
});
