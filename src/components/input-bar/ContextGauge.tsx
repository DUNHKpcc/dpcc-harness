import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContextUsage } from "@/types";
import type { PiContextSnapshot } from "@/types/pi-context";

// ── Token formatting helpers ──

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function formatPercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

export function calculateCacheHitRate(contextUsage: ContextUsage): number {
  const totalInput =
    contextUsage.inputTokens +
    contextUsage.cacheReadTokens +
    contextUsage.cacheCreationTokens;
  if (totalInput <= 0) return 0;
  return (contextUsage.cacheReadTokens / totalInput) * 100;
}

function getContextColor(percent: number): string {
  if (percent >= 80) return "text-red-600 dark:text-red-400";
  if (percent >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground/60";
}

function getContextStrokeColor(percent: number): string {
  if (percent >= 80) return "stroke-red-600 dark:stroke-red-400";
  if (percent >= 60) return "stroke-amber-600 dark:stroke-amber-400";
  return "stroke-foreground/40";
}

export interface ContextGaugeProps {
  contextUsage?: ContextUsage | null;
  contextSnapshot?: PiContextSnapshot | null;
  isCompacting: boolean;
  isProcessing: boolean;
  onCompact?: () => void;
  onOpenInspector?: () => void;
  /** Keep a discoverable inspector entry before Pi emits its first snapshot. */
  showWhenEmpty?: boolean;
  className?: string;
}

/** SVG ring gauge showing context window usage with a tooltip breakdown. */
export const ContextGauge = memo(function ContextGauge({
  contextUsage,
  contextSnapshot,
  isCompacting,
  isProcessing,
  onCompact,
  onOpenInspector,
  showWhenEmpty = false,
  className,
}: ContextGaugeProps) {
  const { t } = useTranslation("input");
  const contextWindow = contextSnapshot?.contextWindow ?? contextUsage?.contextWindow ?? 0;
  const hasUsage = contextWindow > 0;
  if (!hasUsage && !showWhenEmpty) return null;

  const totalInput = contextSnapshot?.usedTokens ?? (contextUsage
    ? contextUsage.inputTokens + contextUsage.cacheReadTokens + contextUsage.cacheCreationTokens
    : 0);
  const isUsageUnknown = !hasUsage || contextSnapshot?.usedTokens === null;
  const cacheHitRate = contextUsage ? calculateCacheHitRate(contextUsage) : 0;
  const percent = isUsageUnknown
    ? 0
    : contextSnapshot?.percent ?? Math.min(100, (totalInput / contextWindow) * 100);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (percent / 100) * circumference;

  const opensInspector = !!onOpenInspector;
  const disabled = !opensInspector && (isProcessing || !onCompact);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            if (onOpenInspector) {
              onOpenInspector();
            } else if (!isProcessing) {
              onCompact?.();
            }
          }}
          data-context-gauge
          aria-label={opensInspector ? t("context.openInspector") : t("context.clickToCompact")}
          disabled={disabled}
          className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:opacity-80 ${disabled ? "opacity-40 cursor-default" : "cursor-pointer"} ${getContextColor(percent)} ${className ?? ""}`}
        >
          {hasUsage ? (
            <>
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                className={isCompacting ? "animate-spin" : "-rotate-90"}
              >
                <circle
                  cx="10"
                  cy="10"
                  r={radius}
                  fill="none"
                  className="stroke-muted-foreground/20 dark:stroke-muted/30"
                  strokeWidth="2.5"
                />
                <circle
                  cx="10"
                  cy="10"
                  r={radius}
                  fill="none"
                  className={
                    isCompacting
                      ? "stroke-foreground/60"
                      : isUsageUnknown ? "stroke-muted-foreground/50" : getContextStrokeColor(percent)
                  }
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={isCompacting ? circumference * 0.7 : dashOffset}
                />
              </svg>
              {isUsageUnknown && !isCompacting ? (
                <span className="absolute text-[10px] font-semibold leading-none text-muted-foreground">?</span>
              ) : null}
            </>
          ) : (
            <Gauge className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        <div className="space-y-1.5 text-xs">
          <div className="font-medium">
            {isCompacting
              ? t("context.compacting")
              : isUsageUnknown
                ? t("context.noSnapshots")
                : t("context.percent", { percent: percent.toFixed(1) })}
          </div>
          {hasUsage && contextSnapshot ? (
            <div className="space-y-0.5 opacity-70">
              <div className="flex justify-between gap-4"><span>{t("context.systemPrompt")}</span><span className="font-mono">{formatTokenCount(contextSnapshot.breakdown.systemPromptTokens)}</span></div>
              <div className="flex justify-between gap-4"><span>{t("context.tools")}</span><span className="font-mono">{formatTokenCount(contextSnapshot.breakdown.toolTokens)}</span></div>
              <div className="flex justify-between gap-4"><span>{t("context.conversation")}</span><span className="font-mono">{formatTokenCount(contextSnapshot.breakdown.conversationTokens)}</span></div>
            </div>
          ) : hasUsage && contextUsage ? (
            <div className="space-y-0.5 opacity-70">
              <div className="flex justify-between gap-4"><span>{t("context.inputTokens")}</span><span className="font-mono">{formatTokenCount(contextUsage.inputTokens)}</span></div>
              <div className="flex justify-between gap-4"><span>{t("context.cacheRead")}</span><span className="font-mono">{formatTokenCount(contextUsage.cacheReadTokens)}</span></div>
              <div className="flex justify-between gap-4"><span>{t("context.cacheCreation")}</span><span className="font-mono">{formatTokenCount(contextUsage.cacheCreationTokens)}</span></div>
              <div className="flex justify-between gap-4"><span>{t("context.cacheHitRate")}</span><span className="font-mono">{formatPercent(cacheHitRate)}</span></div>
              <div className="flex justify-between gap-4"><span>{t("context.outputTokens")}</span><span className="font-mono">{formatTokenCount(contextUsage.outputTokens)}</span></div>
            </div>
          ) : null}
          {hasUsage ? (
            <div className="flex justify-between gap-4 border-t border-background/20 pt-1">
              <span>{t("context.totalWindow")}</span>
              <span className="font-mono">
                {isUsageUnknown ? t("context.unknown") : formatTokenCount(totalInput)} /{" "}
                {formatTokenCount(contextWindow)}
              </span>
            </div>
          ) : (
            <div className="border-t border-background/20 pt-1 text-muted-foreground/70">
              {t("context.noSnapshotsDescription")}
            </div>
          )}
          <div className="border-t border-background/20 pt-1.5 opacity-50">
            {opensInspector ? t("context.clickToInspect") : t("context.clickToCompact")}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
