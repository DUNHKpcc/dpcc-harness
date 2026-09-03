import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  ListTree,
  Minimize2,
  Square,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  PiContextDetails,
  PiContextSnapshot,
  PiContextTimelineEntry,
} from "@/types/pi-context";
import type { ContextUsage } from "@/types";
import { createLegacyPiContextSnapshot } from "@/lib/pi-context-bridge";
import { usePiContextSnapshots } from "@/lib/pi-context-store";

type TimelineCategory = "user" | "assistant" | "tool" | "system";

interface PositionedTimelineEntry {
  entry: PiContextTimelineEntry;
  category: TimelineCategory;
  position: number;
}

interface TimelineLayout {
  entries: PositionedTimelineEntry[];
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

interface TimelineMarkerGroup {
  id: string;
  category: TimelineCategory;
  entries: PositionedTimelineEntry[];
  firstPosition: number;
  position: number;
}

const EMPTY_TIMELINE_ENTRIES: readonly PiContextTimelineEntry[] = [];
const TIMELINE_CATEGORIES: readonly TimelineCategory[] = ["user", "assistant", "tool", "system"];
const TIMELINE_MIN_INTERACTION_WIDTH_REM = 1.75;
const TIMELINE_MARKER_CLASSES: Record<TimelineCategory, string> = {
  user: "bg-sky-600 dark:bg-sky-400",
  assistant: "bg-primary",
  tool: "bg-emerald-600 dark:bg-emerald-400",
  system: "bg-muted-foreground",
};

interface ContextInspectorProps {
  sessionId: string | null | undefined;
  contextUsage?: ContextUsage | null;
  isProcessing: boolean;
  isCompacting: boolean;
  /** Snapshots were restored from session storage; no Pi child is running. */
  isRuntimeDormant?: boolean;
  onCompact?: () => void;
  onStop?: () => void;
  onClose: () => void;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function formatCharacterCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function formatSnapshotTime(capturedAt: number, locale: string): string | null {
  if (!Number.isFinite(capturedAt)) return null;
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(capturedAt);
}

function formatTimelineTime(timestamp: number, locale: string): string | null {
  const formatted = formatSnapshotTime(timestamp, locale);
  if (!formatted) return null;
  return `${formatted}.${new Date(timestamp).getMilliseconds().toString().padStart(3, "0")}`;
}

function getTimelineCategory(kind: PiContextTimelineEntry["kind"]): TimelineCategory {
  switch (kind) {
    case "user":
    case "assistant":
    case "tool":
      return kind;
    default:
      return "system";
  }
}

function getTimelinePosition(index: number, count: number): number {
  if (count <= 1) return 50;
  return 4 + (index / (count - 1)) * 92;
}

function buildTimelineLayout(entries: readonly PiContextTimelineEntry[]): TimelineLayout {
  const orderedEntries = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      if (left.entry.timestamp === null && right.entry.timestamp === null) {
        return left.index - right.index;
      }
      if (left.entry.timestamp === null) return 1;
      if (right.entry.timestamp === null) return -1;
      return left.entry.timestamp - right.entry.timestamp || left.index - right.index;
    });
  const timestamps = orderedEntries.flatMap(({ entry }) => (
    entry.timestamp === null ? [] : [entry.timestamp]
  ));
  const firstTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const lastTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;

  return {
    firstTimestamp,
    lastTimestamp,
    entries: orderedEntries.map(({ entry }, index) => {
      const position = entry.timestamp === null
        || firstTimestamp === null
        || lastTimestamp === null
        || firstTimestamp === lastTimestamp
        ? getTimelinePosition(index, orderedEntries.length)
        : 4 + ((entry.timestamp - firstTimestamp) / (lastTimestamp - firstTimestamp)) * 92;
      return {
        entry,
        category: getTimelineCategory(entry.kind),
        position,
      };
    }),
  };
}

/** Groups markers that would overlap at the timeline's minimum scroll width. */
function buildTimelineMarkerGroups(
  entries: readonly PositionedTimelineEntry[],
  timelineWidthRem: number,
): TimelineMarkerGroup[] {
  const collisionGapPercent = (TIMELINE_MIN_INTERACTION_WIDTH_REM / timelineWidthRem) * 100;
  const groups: TimelineMarkerGroup[] = [];

  for (const category of TIMELINE_CATEGORIES) {
    const categoryEntries = entries.filter((entry) => entry.category === category);
    let currentGroup: TimelineMarkerGroup | null = null;

    for (const entry of categoryEntries) {
      if (currentGroup && entry.position - currentGroup.firstPosition <= collisionGapPercent) {
        const currentCount = currentGroup.entries.length;
        currentGroup.entries.push(entry);
        currentGroup.position = ((currentGroup.position * currentCount) + entry.position) / (currentCount + 1);
        continue;
      }

      currentGroup = {
        id: `${category}:${entry.entry.id}`,
        category,
        entries: [entry],
        firstPosition: entry.position,
        position: entry.position,
      };
      groups.push(currentGroup);
    }
  }

  return groups;
}

function closestDetails(
  snapshots: readonly PiContextSnapshot[],
  selectedIndex: number,
): { details: PiContextDetails; snapshot: PiContextSnapshot } | null {
  for (let index = selectedIndex; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    if (snapshot?.details) return { details: snapshot.details, snapshot };
  }
  return null;
}

function TimelineIcon({ kind }: Pick<PiContextTimelineEntry, "kind">) {
  const className = "size-4 shrink-0 text-muted-foreground";
  switch (kind) {
    case "user":
      return <UserRound className={className} aria-hidden="true" />;
    case "assistant":
      return <Bot className={className} aria-hidden="true" />;
    case "tool":
      return <Wrench className={className} aria-hidden="true" />;
    case "compaction":
    case "branch_summary":
      return <Minimize2 className={className} aria-hidden="true" />;
    default:
      return <FileText className={className} aria-hidden="true" />;
  }
}

function TimelineCategoryIcon({ category }: { category: TimelineCategory }) {
  const className = "size-3.5 shrink-0 text-muted-foreground";
  switch (category) {
    case "user":
      return <UserRound className={className} aria-hidden="true" />;
    case "assistant":
      return <Bot className={className} aria-hidden="true" />;
    case "tool":
      return <Wrench className={className} aria-hidden="true" />;
    default:
      return <FileText className={className} aria-hidden="true" />;
  }
}

function ContextCacheStatus({ isRuntimeDormant }: Pick<ContextInspectorProps, "isRuntimeDormant">) {
  const { t } = useTranslation("input");
  if (!isRuntimeDormant) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-context-cache-status
          tabIndex={0}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
        >
          <History className="size-3.5" aria-hidden="true" />
          {t("context.cached")}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("context.cachedDescription")}</TooltipContent>
    </Tooltip>
  );
}

export function ContextInspector({
  sessionId,
  contextUsage,
  isProcessing,
  isCompacting,
  isRuntimeDormant = false,
  onCompact,
  onStop,
  onClose,
}: ContextInspectorProps) {
  const { t, i18n } = useTranslation("input");
  const piContextSnapshots = usePiContextSnapshots(sessionId);
  const legacyContextSnapshot = useMemo(
    () => contextUsage ? createLegacyPiContextSnapshot(contextUsage) : null,
    [contextUsage],
  );
  const snapshots = useMemo(
    () => piContextSnapshots.length > 0
      ? piContextSnapshots
      : legacyContextSnapshot ? [legacyContextSnapshot] : [],
    [legacyContextSnapshot, piContextSnapshots],
  );
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, snapshots.length - 1));
  const [selectedTimelineEntryId, setSelectedTimelineEntryId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIndex(Math.max(0, snapshots.length - 1));
    setSelectedTimelineEntryId(null);
  }, [sessionId, snapshots.length]);

  const inspectorHeader = (
    <div
      data-context-inspector-header
      className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-base font-semibold">{t("context.inspectorTitle")}</h2>
          <ContextCacheStatus isRuntimeDormant={isRuntimeDormant} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("context.inspectorDescription")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isProcessing && onStop ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-context-inspector-stop
                aria-label={t("action.stop", { ns: "common" })}
                onClick={onStop}
              >
                <Square />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("action.stop", { ns: "common" })}</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-context-inspector-close
              aria-label={t("context.closeInspector")}
              onClick={onClose}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("context.closeInspector")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );

  const snapshot = snapshots[Math.min(selectedIndex, Math.max(0, snapshots.length - 1))] ?? null;
  const snapshotTime = useMemo(
    () => snapshot ? formatSnapshotTime(snapshot.capturedAt, i18n.language) : null,
    [i18n.language, snapshot],
  );
  const detailSource = useMemo(
    () => closestDetails(snapshots, selectedIndex),
    [selectedIndex, snapshots],
  );
  const detailSnapshotTime = useMemo(
    () => detailSource ? formatSnapshotTime(detailSource.snapshot.capturedAt, i18n.language) : null,
    [detailSource, i18n.language],
  );
  const detailTimeline = detailSource?.details?.timeline ?? EMPTY_TIMELINE_ENTRIES;
  const timelineLayout = useMemo(
    () => buildTimelineLayout(detailTimeline),
    [detailTimeline],
  );
  const timelineMinimumWidth = Math.max(48, Math.ceil(timelineLayout.entries.length * 1.25));
  const timelineMarkerGroups = useMemo(
    () => buildTimelineMarkerGroups(timelineLayout.entries, timelineMinimumWidth),
    [timelineLayout.entries, timelineMinimumWidth],
  );

  if (!snapshot) {
    return (
      <section data-context-inspector className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background pt-14">
        {inspectorHeader}
        <div data-context-inspector-empty className="px-5 py-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground/80">{t("context.noSnapshots")}</p>
          <p className="mt-1 text-xs">
            {t(isRuntimeDormant ? "context.noSnapshotsDormant" : "context.noSnapshotsDescription")}
          </p>
        </div>
      </section>
    );
  }

  const usedLabel = snapshot.usedTokens === null
    ? t("context.unknown")
    : formatTokenCount(snapshot.usedTokens);
  const usageTokens = snapshot.usedTokens ?? 0;
  const hasKnownUsage = snapshot.usedTokens !== null && snapshot.contextWindow > 0;
  const usedPercent = hasKnownUsage
    ? Math.min(100, Math.max(0, (usageTokens / snapshot.contextWindow) * 100))
    : 0;
  const remainingTokens = hasKnownUsage
    ? Math.max(0, snapshot.contextWindow - usageTokens)
    : null;
  const remainingLabel = remainingTokens === null
    ? t("context.unknown")
    : formatTokenCount(remainingTokens);
  const canCompact = snapshot.source === "pi-extension" && !!onCompact;
  const phaseKey = `context.phase.${snapshot.phase}`;
  const compaction = snapshot.compaction;
  const metrics = [
    ["systemPrompt", snapshot.breakdown.systemPromptTokens],
    ["tools", snapshot.breakdown.toolTokens],
    ["conversation", snapshot.breakdown.conversationTokens],
    ["reserved", snapshot.breakdown.reservedOutputTokens],
    ["free", snapshot.breakdown.freeTokens],
  ] as const;
  const details = detailSource?.details ?? null;
  const detailsAreCurrent = detailSource?.snapshot.id === snapshot.id;
  const selectedTimelineEntry = timelineLayout.entries.find(({ entry }) => (
    entry.id === selectedTimelineEntryId
  )) ?? timelineLayout.entries.at(-1) ?? null;
  const selectedTimelineGroup = selectedTimelineEntry
    ? timelineMarkerGroups.find((group) => group.entries.some(({ entry }) => (
      entry.id === selectedTimelineEntry.entry.id
    ))) ?? null
    : null;
  const selectedTimelineLabel = selectedTimelineEntry
    ? selectedTimelineEntry.entry.label ?? t(`context.timelineKind.${selectedTimelineEntry.entry.kind}`)
    : null;
  const selectedTimelineTimestamp = selectedTimelineEntry?.entry.timestamp ?? null;
  const selectedTimelineTime = selectedTimelineTimestamp === null
    ? null
    : formatTimelineTime(selectedTimelineTimestamp, i18n.language);
  const timelineStartTime = timelineLayout.firstTimestamp === null
    ? null
    : formatTimelineTime(timelineLayout.firstTimestamp, i18n.language);
  const timelineEndTime = timelineLayout.lastTimestamp === null
    ? null
    : formatTimelineTime(timelineLayout.lastTimestamp, i18n.language);
  return (
    <section data-context-inspector className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background pt-14">
      {inspectorHeader}

      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
          <div className="min-w-0 text-xs text-muted-foreground">
            <span data-context-snapshot-index>
              {t("context.snapshotOf", { current: selectedIndex + 1, total: snapshots.length })}
            </span>
            {snapshotTime ? <span className="ms-2">{snapshotTime}</span> : null}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-context-previous
                  aria-label={t("context.previousSnapshot")}
                  disabled={selectedIndex === 0}
                  onClick={() => setSelectedIndex((index) => Math.max(0, index - 1))}
                >
                  <ChevronLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("context.previousSnapshot")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-context-next
                  aria-label={t("context.nextSnapshot")}
                  disabled={selectedIndex >= snapshots.length - 1}
                  onClick={() => setSelectedIndex((index) => Math.min(snapshots.length - 1, index + 1))}
                >
                  <ChevronRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("context.nextSnapshot")}</TooltipContent>
            </Tooltip>
          </div>
      </div>

      <ScrollArea data-context-inspector-scroll className="min-h-0 flex-1">
          <Tabs defaultValue="overview" className="gap-0">
            <TabsList variant="line" className="h-10 w-full justify-start gap-4 border-b px-5">
              <TabsTrigger value="overview">{t("context.overview")}</TabsTrigger>
              <TabsTrigger value="details">{t("context.details")}</TabsTrigger>
              <TabsTrigger value="timeline">{t("context.timeline")}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0">
              <div className="space-y-5 px-5 py-4">
                <section className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {usedLabel}
                      <span className="ms-1 text-sm font-normal text-muted-foreground">
                        / {formatTokenCount(snapshot.contextWindow)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {isCompacting ? t("context.compacting") : t(phaseKey)}
                      {snapshot.model ? <span className="ms-2">{snapshot.model}</span> : null}
                    </div>
                  </div>
                  <div className="text-right text-sm font-medium tabular-nums text-muted-foreground">
                    {hasKnownUsage ? `${usedPercent.toFixed(1)}%` : t("context.unknown")}
                  </div>
                </section>

                <section className="space-y-2.5">
                  <div
                    data-context-usage-bar
                    data-context-usage-unavailable={hasKnownUsage ? undefined : "true"}
                    className="flex h-2 w-full overflow-hidden bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={snapshot.contextWindow}
                    aria-valuenow={hasKnownUsage
                      ? Math.min(usageTokens, snapshot.contextWindow)
                      : undefined}
                    aria-label={hasKnownUsage
                      ? t("context.usageProgressLabel", { used: usedLabel, remaining: remainingLabel })
                      : t("context.unknown")}
                  >
                    {hasKnownUsage ? (
                      <>
                        <div
                          data-context-usage-used
                          className="h-full bg-primary"
                          style={{ width: `${usedPercent}%` }}
                        />
                        <div
                          data-context-usage-remaining
                          className="h-full bg-foreground/10"
                          style={{ width: `${100 - usedPercent}%` }}
                        />
                      </>
                    ) : (
                      <div className="h-full w-full bg-muted-foreground/10" />
                    )}
                  </div>
                  <div
                    data-context-usage-labels
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground"
                  >
                    <span>
                      {t("context.used")} <span className="font-medium text-foreground">{usedLabel}</span>
                    </span>
                    <span>
                      {t("context.remaining")} <span className="font-medium text-foreground">{remainingLabel}</span>
                    </span>
                  </div>
                </section>

                <section className="border-y py-3">
                  <p className="mb-3 text-xs text-muted-foreground">
                    {t("context.breakdownEstimate")}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    {metrics.map(([label, value]) => (
                      <div key={label} className="flex min-w-0 items-center justify-between gap-3">
                        <dt className="truncate text-muted-foreground">{t(`context.${label}`)}</dt>
                        <dd className="font-mono text-xs tabular-nums">{formatTokenCount(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                {compaction ? (
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <h3 className="font-medium">{t("context.compaction")}</h3>
                      <span className="text-xs text-muted-foreground">
                        {t(`context.compactionReason.${compaction.reason}`)}
                        {compaction.tokensBefore !== null
                          ? ` - ${formatTokenCount(compaction.tokensBefore)}`
                          : ""}
                      </span>
                    </div>
                    {compaction.summary ? (
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-s-2 border-border ps-3 text-xs leading-5 text-muted-foreground">
                        {compaction.summary}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("context.noCompactionSummary")}</p>
                    )}
                  </section>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="details" className="mt-0">
              <div className="space-y-5 px-5 py-4">
                {!details ? (
                  <p data-context-details-empty className="py-4 text-sm text-muted-foreground">
                    {t("context.noDetails")}
                  </p>
                ) : (
                  <>
                    {!detailsAreCurrent && detailSnapshotTime ? (
                      <p className="text-xs text-muted-foreground">
                        {t("context.detailSnapshotFrom", { time: detailSnapshotTime })}
                      </p>
                    ) : null}
                    <section data-context-detail-system className="border-b pb-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                          <h3>{t("context.systemPrompt")}</h3>
                        </div>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatTokenCount(details.systemPrompt.tokenEstimate)} {t("context.estimated")}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t("context.characterCount", {
                          count: formatCharacterCount(details.systemPrompt.characterCount),
                        })}
                      </p>
                    </section>

                    <section data-context-detail-tools className="space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                          <Wrench className="size-4 text-muted-foreground" aria-hidden="true" />
                          <h3>{t("context.activeTools", { count: details.totalTools })}</h3>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("context.estimated")}
                        </span>
                      </div>
                      {details.tools.length > 0 ? (
                        <dl className="divide-y border-y">
                          {details.tools.map((tool) => (
                            <div key={tool.name} className="flex gap-4 py-3">
                              <dt className="min-w-0 flex-1">
                                <p className="truncate font-mono text-xs">{tool.name}</p>
                                {tool.description ? (
                                  <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                                    {tool.description}
                                  </p>
                                ) : null}
                              </dt>
                              <dd className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                                {formatTokenCount(tool.tokenEstimate)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t("context.noActiveTools")}</p>
                      )}
                      {details.omittedTools > 0 ? (
                        <p data-context-detail-omitted className="text-xs text-muted-foreground">
                          {t("context.omittedTools", { count: details.omittedTools })}
                        </p>
                      ) : null}
                    </section>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="timeline" className="mt-0">
              <div data-context-timeline className="px-5 py-4">
                {!details ? (
                  <p data-context-timeline-empty className="py-4 text-sm text-muted-foreground">
                    {t("context.noDetails")}
                  </p>
                ) : (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <ListTree className="size-4 text-muted-foreground" aria-hidden="true" />
                        <h3>{t("context.contextTimeline", { count: details.totalEntries })}</h3>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t("context.estimated")}
                      </span>
                    </div>
                    {details.omittedEntries > 0 ? (
                      <p data-context-detail-omitted className="text-xs text-muted-foreground">
                        {t("context.omittedEntries", { count: details.omittedEntries })}
                      </p>
                    ) : null}
                    {timelineLayout.entries.length > 0 && selectedTimelineEntry && selectedTimelineLabel ? (
                      <>
                        <div data-context-timeline-canvas className="overflow-x-auto border-y py-3">
                          <div className="space-y-2.5" style={{ minWidth: `${timelineMinimumWidth}rem` }}>
                            {TIMELINE_CATEGORIES.map((category) => {
                              const categoryGroups = timelineMarkerGroups.filter((group) => group.category === category);
                              if (categoryGroups.length === 0) return null;
                              return (
                                <div
                                  key={category}
                                  data-context-timeline-track={category}
                                  className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3"
                                >
                                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                    <TimelineCategoryIcon category={category} />
                                    <span className="truncate">{t(`context.timelineCategory.${category}`)}</span>
                                  </div>
                                  <div className="relative h-8">
                                    <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
                                    {categoryGroups.map((group) => {
                                      const isGrouped = group.entries.length > 1;
                                      const representative = group.entries.at(-1)!;
                                      const entryTime = representative.entry.timestamp === null
                                        ? null
                                        : formatTimelineTime(representative.entry.timestamp, i18n.language);
                                      const label = representative.entry.label
                                        ?? t(`context.timelineKind.${representative.entry.kind}`);
                                      const isSelected = group.entries.some(({ entry }) => (
                                        selectedTimelineEntry.entry.id === entry.id
                                      ));
                                      const markerLabel = isGrouped
                                        ? t("context.timelineGroupLabel", {
                                          category: t(`context.timelineCategory.${category}`),
                                          count: group.entries.length,
                                        })
                                        : `${t(`context.timelineCategory.${category}`)}: ${label}`;
                                      return (
                                        <Tooltip key={group.id}>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              data-context-timeline-marker
                                              data-context-timeline-category={category}
                                              data-context-timeline-entry-id={representative.entry.id}
                                              data-context-timeline-grouped={isGrouped || undefined}
                                              data-context-timeline-group-count={group.entries.length}
                                              aria-label={markerLabel}
                                              aria-pressed={isSelected}
                                              onClick={() => setSelectedTimelineEntryId(representative.entry.id)}
                                              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background font-mono text-[10px] font-semibold leading-none text-primary-foreground shadow-sm transition-transform hover:scale-110 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${isGrouped ? "h-7 min-w-7 px-1" : "size-7"} ${TIMELINE_MARKER_CLASSES[category]} ${isSelected ? "ring-2 ring-foreground ring-offset-2" : ""}`}
                                              style={{ left: `${group.position}%` }}
                                            >
                                              {isGrouped ? group.entries.length : null}
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="max-w-56">
                                            <p className="font-medium">
                                              {isGrouped ? t("context.timelineGroup", { count: group.entries.length }) : label}
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                              {t(`context.timelineCategory.${category}`)}
                                              {entryTime ? ` · ${entryTime}` : ""}
                                            </p>
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                            {timelineStartTime && timelineEndTime ? (
                              <div
                                data-context-timeline-axis
                                className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3 text-[11px] tabular-nums text-muted-foreground"
                              >
                                <span />
                                <div className="flex justify-between border-t pt-2">
                                  <span>{timelineStartTime}</span>
                                  <span>{timelineEndTime}</span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {selectedTimelineGroup && selectedTimelineGroup.entries.length > 1 ? (
                          <section
                            data-context-timeline-group
                            data-context-timeline-group-count={selectedTimelineGroup.entries.length}
                            className="space-y-2 border-b pb-4"
                          >
                            <div className="flex items-center justify-between gap-4 text-sm font-medium">
                              <div className="flex min-w-0 items-center gap-2">
                                <TimelineCategoryIcon category={selectedTimelineGroup.category} />
                                <h3>{t("context.timelineGroup", { count: selectedTimelineGroup.entries.length })}</h3>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {t(`context.timelineCategory.${selectedTimelineGroup.category}`)}
                              </span>
                            </div>
                            <div className="divide-y border-y">
                              {selectedTimelineGroup.entries.map((item) => {
                                const itemLabel = item.entry.label ?? t(`context.timelineKind.${item.entry.kind}`);
                                const itemTime = item.entry.timestamp === null
                                  ? null
                                  : formatTimelineTime(item.entry.timestamp, i18n.language);
                                const isSelected = selectedTimelineEntry.entry.id === item.entry.id;
                                return (
                                  <button
                                    key={item.entry.id}
                                    type="button"
                                    data-context-timeline-group-entry
                                    data-context-timeline-group-entry-id={item.entry.id}
                                    aria-current={isSelected ? "true" : undefined}
                                    onClick={() => setSelectedTimelineEntryId(item.entry.id)}
                                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${isSelected ? "bg-muted" : ""}`}
                                  >
                                    <TimelineIcon kind={item.entry.kind} />
                                    <span className="min-w-0 flex-1 truncate font-medium">{itemLabel}</span>
                                    {itemTime ? (
                                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{itemTime}</span>
                                    ) : null}
                                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                                      {formatTokenCount(item.entry.tokenEstimate)}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        ) : null}

                        <section
                          data-context-timeline-detail
                          data-context-timeline-entry-id={selectedTimelineEntry.entry.id}
                          className="space-y-3 border-b pb-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                              <TimelineIcon kind={selectedTimelineEntry.entry.kind} />
                              <h3 className="truncate">{selectedTimelineLabel}</h3>
                            </div>
                            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                              {formatTokenCount(selectedTimelineEntry.entry.tokenEstimate)} {t("context.estimated")}
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y py-3 text-xs">
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">{t("context.timelineCategoryLabel")}</dt>
                              <dd className="mt-0.5 truncate font-medium">
                                {t(`context.timelineCategory.${selectedTimelineEntry.category}`)}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">{t("context.timelineTimestamp")}</dt>
                              <dd className="mt-0.5 truncate font-mono tabular-nums">
                                {selectedTimelineTime ?? t("context.noTimelineTimestamp")}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">{t("context.timelineTokenEstimate")}</dt>
                              <dd className="mt-0.5 truncate font-mono tabular-nums">
                                {formatTokenCount(selectedTimelineEntry.entry.tokenEstimate)}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">{t("context.timelineCharacters")}</dt>
                              <dd className="mt-0.5 truncate font-mono tabular-nums">
                                {formatCharacterCount(selectedTimelineEntry.entry.characterCount)}
                              </dd>
                            </div>
                          </dl>
                          {selectedTimelineEntry.entry.excerpt ? (
                            <p className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground/80">
                              {selectedTimelineEntry.entry.excerpt}
                              {selectedTimelineEntry.entry.excerptTruncated ? "..." : ""}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">{t("context.noTimelineExcerpt")}</p>
                          )}
                        </section>
                      </>
                    ) : (
                      <p className="py-4 text-sm text-muted-foreground">{t("context.noTimelineEntries")}</p>
                    )}
                  </section>
                )}
              </div>
            </TabsContent>
          </Tabs>
      </ScrollArea>

      {canCompact ? (
        <div data-context-inspector-footer className="flex shrink-0 justify-end border-t px-5 py-3">
          <Button
            type="button"
            size="sm"
            onClick={onCompact}
            disabled={isProcessing || isCompacting}
          >
            <Minimize2 />
            {t("context.compactNow")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
