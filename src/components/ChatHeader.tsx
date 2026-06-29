import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Info, Loader2, PanelLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToolPickerMenu } from "./ToolPickerMenu";
import { UPSTREAM_REQUEST_SCROLL_AREA_CLASS } from "@/components/lib/chat-header-layout";
import { isMac } from "@/lib/utils";
import { getUpstreamRequestCount } from "@/lib/usage/upstream-requests";
import type { AcpPermissionBehavior, UpstreamRequestRecord } from "@/types";
import type { ToolId } from "@/types/tools";

interface ChatHeaderProps {
  islandLayout: boolean;
  sidebarOpen: boolean;
  showSidebarToggle?: boolean;
  isProcessing: boolean;
  model?: string;
  sessionId?: string;
  totalCost: number;
  upstreamRequestCount?: number;
  requestLog?: UpstreamRequestRecord[];
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
  /** Tool picker menu props */
  activeTools?: Set<ToolId>;
  onToggleTool?: (toolId: ToolId) => void;
  availableContextual?: Set<ToolId>;
  toolOrder?: ToolId[];
  projectPath?: string;
}

function formatTokenCount(value: number | undefined): string {
  if (!value) return "0";
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

function formatDuration(value: number | undefined): string {
  if (!value) return "";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
}

function UpstreamRequestRow({
  record,
  ordinal,
}: {
  record: UpstreamRequestRecord;
  ordinal: number;
}) {
  const { t } = useTranslation("chat");
  const tokenTotal =
    (record.inputTokens ?? 0) +
    (record.outputTokens ?? 0) +
    (record.cacheReadTokens ?? 0) +
    (record.cacheCreationTokens ?? 0) +
    (record.reasoningOutputTokens ?? 0);
  const duration = formatDuration(record.durationMs);

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-foreground/75">
              {t("header.requestOrdinal", { ordinal })}
            </span>
            <Badge variant="outline" className="h-4 rounded-full px-1.5 text-[9px] uppercase">
              {record.engine}
            </Badge>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {record.model || t("header.unknownModel")}
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {t(`header.requestStatus.${record.status}`)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <div className="flex justify-between gap-2">
          <span>{t("header.tokens")}</span>
          <span className="font-mono text-foreground/70">{formatTokenCount(tokenTotal)}</span>
        </div>
        {duration && (
          <div className="flex justify-between gap-2">
            <span>{t("header.duration")}</span>
            <span className="font-mono text-foreground/70">{duration}</span>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span>{t("header.inputTokens")}</span>
          <span className="font-mono text-foreground/70">{formatTokenCount(record.inputTokens)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{t("header.outputTokens")}</span>
          <span className="font-mono text-foreground/70">{formatTokenCount(record.outputTokens)}</span>
        </div>
        {record.costUSD != null && (
          <div className="col-span-2 flex justify-between gap-2">
            <span>{t("header.cost")}</span>
            <span className="font-mono text-foreground/70">${record.costUSD.toFixed(4)}</span>
          </div>
        )}
        {record.note === "codex_cost_unavailable" && (
          <div className="col-span-2 text-[10px] text-muted-foreground/70">
            {t("header.codexCostUnavailable")}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatHeader = memo(function ChatHeader({
  islandLayout,
  sidebarOpen,
  showSidebarToggle = true,
  isProcessing,
  model,
  sessionId,
  totalCost,
  upstreamRequestCount,
  requestLog = [],
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
  activeTools,
  onToggleTool,
  availableContextual,
  toolOrder,
  projectPath,
}: ChatHeaderProps) {
  const { t } = useTranslation("chat");
  const modeLabel = permissionMode
    ? t(`header.permissionMode.${permissionMode}`, { defaultValue: permissionMode })
    : null;
  const acpBehaviorLabel = acpPermissionBehavior
    ? t(`header.acpBehavior.${acpPermissionBehavior}`)
    : null;
  const permissionDisplay = acpBehaviorLabel ?? modeLabel;
  const requestCount = getUpstreamRequestCount(requestLog, upstreamRequestCount);
  const recentRequests = requestLog.slice(-10).reverse();
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
  if (requestCount > 0) detailRows.push({ label: t("header.requests"), value: String(requestCount) });
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

      {/* Session info, tool picker, and pane close */}
      {(showDevSeedButton || hasDetails || onClosePane || (activeTools && onToggleTool)) && (
        <div className="ms-auto flex items-center gap-1.5">
          {activeTools && onToggleTool && toolOrder && (
            <ToolPickerMenu
              activeTools={activeTools}
              onToggleTool={onToggleTool}
              availableContextual={availableContextual}
              toolOrder={toolOrder}
              projectPath={projectPath}
            />
          )}
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
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="no-drag flex cursor-pointer items-center justify-center gap-1 rounded-full px-1 py-0.5 text-muted-foreground/30 transition-colors hover:text-muted-foreground"
                  aria-label={t("header.details")}
                >
                  <Info className="h-3.5 w-3.5" />
                  {requestCount > 0 && (
                    <span className="font-mono text-[10px] leading-none tabular-nums">
                      {requestCount}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="end" className="w-[360px] overflow-hidden p-0">
                <div className="border-b border-border/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-foreground/80">{t("header.details")}</span>
                    {requestCount > 0 && (
                      <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-semibold tabular-nums">
                        {t("header.requestCount", { count: requestCount })}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-1 px-3 py-2 text-xs">
                  {detailRows.map((row) => (
                    <div key={row.label} className="flex justify-between gap-6">
                      <span className="opacity-70">{row.label}</span>
                      <span className="font-mono text-end">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border/50">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                    {t("header.upstreamRequests")}
                  </div>
                  {recentRequests.length > 0 ? (
                    <ScrollArea className={UPSTREAM_REQUEST_SCROLL_AREA_CLASS}>
                      <div className="space-y-2 px-3 pb-3">
                        {recentRequests.map((record, index) => (
                          <UpstreamRequestRow
                            key={record.id}
                            record={record}
                            ordinal={Math.max(1, requestCount - index)}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="px-3 pb-3 text-xs text-muted-foreground/70">
                      {t("header.noRequests")}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  if (prev.islandLayout !== next.islandLayout) return false;
  if (prev.sidebarOpen !== next.sidebarOpen) return false;
  if (prev.showSidebarToggle !== next.showSidebarToggle) return false;
  if (prev.isProcessing !== next.isProcessing) return false;
  if (prev.model !== next.model) return false;
  if (prev.sessionId !== next.sessionId) return false;
  if (prev.totalCost !== next.totalCost) return false;
  if (prev.upstreamRequestCount !== next.upstreamRequestCount) return false;
  if (prev.requestLog !== next.requestLog) return false;
  if (prev.title !== next.title) return false;
  if (prev.titleGenerating !== next.titleGenerating) return false;
  if (prev.planMode !== next.planMode) return false;
  if (prev.permissionMode !== next.permissionMode) return false;
  if (prev.acpPermissionBehavior !== next.acpPermissionBehavior) return false;
  if (prev.onToggleSidebar !== next.onToggleSidebar) return false;
  if (prev.onClosePane !== next.onClosePane) return false;
  if (prev.onToggleTool !== next.onToggleTool) return false;
  if (prev.projectPath !== next.projectPath) return false;
  if (prev.toolOrder !== next.toolOrder) return false;
  // Compare Sets by content
  const prevActive = prev.activeTools;
  const nextActive = next.activeTools;
  if (prevActive !== nextActive) {
    if (!prevActive || !nextActive || prevActive.size !== nextActive.size) return false;
    for (const id of prevActive) { if (!nextActive.has(id)) return false; }
  }
  const prevCtx = prev.availableContextual;
  const nextCtx = next.availableContextual;
  if (prevCtx !== nextCtx) {
    if (!prevCtx || !nextCtx || prevCtx.size !== nextCtx.size) return false;
    for (const id of prevCtx) { if (!nextCtx.has(id)) return false; }
  }
  return true;
});
