import type { ContextUsage, SummaryUIMessage } from "@/types";
import type {
  PiContextBreakdown,
  PiContextCompaction,
  PiContextCompactionReason,
  PiContextDetails,
  PiContextSnapshot,
  PiContextSnapshotPhase,
  PiContextTimelineEntry,
  PiContextTimelineKind,
  PiContextToolDetails,
} from "@/types/pi-context";

export const PI_CONTEXT_BRIDGE_PREFIX = "__PCC_AGENT_PI_CONTEXT_V1__:";
export const MAX_PI_CONTEXT_SNAPSHOTS = 48;

const MAX_BRIDGE_MESSAGE_LENGTH = 24_000;
const MAX_SNAPSHOT_ID_LENGTH = 180;
const MAX_MODEL_LENGTH = 240;
const MAX_SUMMARY_LENGTH = 6_000;
const MAX_TOKEN_VALUE = 100_000_000;
const MAX_DETAIL_COUNT = 100_000;
const MAX_DETAIL_TOOLS = 24;
const MAX_DETAIL_TIMELINE_ENTRIES = 48;
const MAX_DETAIL_LABEL_LENGTH = 240;
const MAX_DETAIL_DESCRIPTION_LENGTH = 240;
const MAX_DETAIL_EXCERPT_LENGTH = 320;

const SNAPSHOT_PHASES = new Set<PiContextSnapshotPhase>([
  "session_start",
  "request",
  "settled",
  "compacting",
  "compacted",
]);

const COMPACTION_REASONS = new Set<PiContextCompactionReason>([
  "manual",
  "threshold",
  "overflow",
  "unknown",
]);

const TIMELINE_KINDS = new Set<PiContextTimelineKind>([
  "user",
  "assistant",
  "tool",
  "compaction",
  "branch_summary",
  "custom",
  "other",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_TOKEN_VALUE) {
    return fallback;
  }
  return Math.round(value);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
    return null;
  }
  return value;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function detailCount(value: unknown, fallback: number): number {
  const count = nonNegativeNumber(value, fallback);
  return Math.min(MAX_DETAIL_COUNT, count ?? fallback);
}

function normalizeBreakdown(
  value: unknown,
  usedTokens: number | null,
  contextWindow: number,
): PiContextBreakdown {
  const record = isRecord(value) ? value : {};
  const systemPromptTokens = nonNegativeNumber(record.systemPromptTokens, 0) ?? 0;
  const toolTokens = nonNegativeNumber(record.toolTokens, 0) ?? 0;
  const conversationTokens = nonNegativeNumber(
    record.conversationTokens,
    usedTokens === null ? 0 : Math.max(0, usedTokens - systemPromptTokens - toolTokens),
  ) ?? 0;
  const reservedOutputTokens = nonNegativeNumber(record.reservedOutputTokens, 0) ?? 0;
  const freeTokens = nonNegativeNumber(
    record.freeTokens,
    usedTokens === null ? contextWindow : Math.max(0, contextWindow - usedTokens - reservedOutputTokens),
  ) ?? 0;
  return {
    systemPromptTokens,
    toolTokens,
    conversationTokens,
    freeTokens,
    reservedOutputTokens,
  };
}

function normalizeCompaction(value: unknown): PiContextCompaction | undefined {
  if (!isRecord(value)) return undefined;
  const reason = boundedString(value.reason, 32) as PiContextCompactionReason | null;
  const summary = boundedString(value.summary, MAX_SUMMARY_LENGTH);
  const tokensBefore = nonNegativeNumber(value.tokensBefore);
  if (!reason && !summary && tokensBefore === null) return undefined;
  return {
    reason: reason && COMPACTION_REASONS.has(reason) ? reason : "unknown",
    tokensBefore,
    ...(summary ? { summary } : {}),
  };
}

function normalizeToolDetails(value: unknown): PiContextToolDetails | null {
  if (!isRecord(value)) return null;
  const name = boundedString(value.name, MAX_DETAIL_LABEL_LENGTH);
  const tokenEstimate = nonNegativeNumber(value.tokenEstimate);
  if (!name || tokenEstimate === null) return null;
  const description = value.description === null
    ? null
    : boundedString(value.description, MAX_DETAIL_DESCRIPTION_LENGTH);
  if (value.description !== null && !description) return null;
  return { name, description, tokenEstimate };
}

function normalizeTimelineEntry(value: unknown): PiContextTimelineEntry | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id, MAX_SNAPSHOT_ID_LENGTH);
  const kind = boundedString(value.kind, 32) as PiContextTimelineKind | null;
  const tokenEstimate = nonNegativeNumber(value.tokenEstimate);
  const characterCount = nonNegativeNumber(value.characterCount);
  if (!id || !kind || !TIMELINE_KINDS.has(kind) || tokenEstimate === null || characterCount === null) {
    return null;
  }

  const label = value.label === null ? null : boundedString(value.label, MAX_DETAIL_LABEL_LENGTH);
  if (value.label !== null && !label) return null;
  const excerpt = value.excerpt === null ? null : boundedString(value.excerpt, MAX_DETAIL_EXCERPT_LENGTH);
  if (value.excerpt !== null && !excerpt) return null;
  return {
    id,
    kind,
    label,
    timestamp: value.timestamp === null ? null : timestamp(value.timestamp),
    tokenEstimate,
    characterCount,
    excerpt,
    excerptTruncated: value.excerptTruncated === true,
  };
}

function normalizeDetails(value: unknown): PiContextDetails | undefined {
  if (!isRecord(value)) return undefined;
  const systemPrompt = isRecord(value.systemPrompt) ? value.systemPrompt : null;
  if (!systemPrompt) return undefined;
  const characterCount = nonNegativeNumber(systemPrompt.characterCount);
  const tokenEstimate = nonNegativeNumber(systemPrompt.tokenEstimate);
  if (characterCount === null || tokenEstimate === null) return undefined;

  const tools = Array.isArray(value.tools)
    ? value.tools
      .slice(0, MAX_DETAIL_TOOLS)
      .map(normalizeToolDetails)
      .filter((tool): tool is PiContextToolDetails => tool !== null)
    : [];
  const totalTools = Math.max(tools.length, detailCount(value.totalTools, tools.length));
  const omittedTools = Math.max(0, totalTools - tools.length);

  const timeline = Array.isArray(value.timeline)
    ? value.timeline
      .slice(0, MAX_DETAIL_TIMELINE_ENTRIES)
      .map(normalizeTimelineEntry)
      .filter((entry): entry is PiContextTimelineEntry => entry !== null)
    : [];
  const totalEntries = Math.max(timeline.length, detailCount(value.totalEntries, timeline.length));
  const omittedEntries = Math.max(0, totalEntries - timeline.length);

  return {
    systemPrompt: { characterCount, tokenEstimate },
    tools,
    totalTools,
    omittedTools,
    timeline,
    totalEntries,
    omittedEntries,
  };
}

export function parsePiContextSnapshot(
  value: unknown,
  source: PiContextSnapshot["source"] = "pi-extension",
): PiContextSnapshot | null {
  if (!isRecord(value) || value.version !== 1) return null;

  const id = boundedString(value.id, MAX_SNAPSHOT_ID_LENGTH);
  const phase = boundedString(value.phase, 32) as PiContextSnapshotPhase | null;
  const capturedAt = timestamp(value.capturedAt);
  const contextWindow = nonNegativeNumber(value.contextWindow);
  if (!id || !phase || !SNAPSHOT_PHASES.has(phase) || capturedAt === null || !contextWindow) {
    return null;
  }

  const usedTokens = value.usedTokens === null ? null : nonNegativeNumber(value.usedTokens);
  if (value.usedTokens !== null && usedTokens === null) return null;
  const model = boundedString(value.model, MAX_MODEL_LENGTH);
  const percent = usedTokens === null
    ? null
    : Math.min(100, Math.max(0, (usedTokens / contextWindow) * 100));

  const compaction = normalizeCompaction(value.compaction);
  const details = normalizeDetails(value.details);
  return {
    version: 1,
    id,
    capturedAt,
    phase,
    source,
    model,
    usedTokens,
    contextWindow,
    percent,
    breakdown: normalizeBreakdown(value.breakdown, usedTokens, contextWindow),
    ...(compaction ? { compaction } : {}),
    ...(details ? { details } : {}),
  };
}

/** Parse a Pi extension marker without allowing it to become visible chat text. */
export function parsePiContextBridgeMessage(text: string): PiContextSnapshot | null {
  if (!text.startsWith(PI_CONTEXT_BRIDGE_PREFIX) || text.length > MAX_BRIDGE_MESSAGE_LENGTH) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(text.slice(PI_CONTEXT_BRIDGE_PREFIX.length));
  } catch {
    return null;
  }
  return parsePiContextSnapshot(value);
}

export function appendPiContextSnapshot(
  previous: readonly PiContextSnapshot[],
  snapshot: PiContextSnapshot,
): PiContextSnapshot[] {
  const index = previous.findIndex((item) => item.id === snapshot.id);
  const existing = index === -1 ? undefined : previous[index];
  const nextSnapshot = snapshot.details || !existing?.details
    ? snapshot
    : { ...snapshot, details: existing.details };
  const next = index === -1
    ? [...previous, nextSnapshot]
    : previous.map((item, itemIndex) => itemIndex === index ? nextSnapshot : item);
  const bounded = next.length > MAX_PI_CONTEXT_SNAPSHOTS
    ? next.slice(next.length - MAX_PI_CONTEXT_SNAPSHOTS)
    : next;
  if (!nextSnapshot.details) return bounded;

  // Detail payloads contain bounded excerpts. Keep one latest copy so a long
  // session's persisted inspector history remains small and predictable.
  return bounded.map((item) => {
    if (item.id === nextSnapshot.id || !item.details) return item;
    const { details: _details, ...withoutDetails } = item;
    return withoutDetails;
  });
}

/** Use the legacy ACP meter as a one-item inspector when no Pi snapshot exists yet. */
export function createLegacyPiContextSnapshot(
  contextUsage: ContextUsage,
  capturedAt = Date.now(),
): PiContextSnapshot | null {
  if (!Number.isFinite(contextUsage.contextWindow) || contextUsage.contextWindow <= 0) return null;
  const usedTokens = Math.max(
    0,
    contextUsage.inputTokens + contextUsage.cacheReadTokens + contextUsage.cacheCreationTokens,
  );
  return {
    version: 1,
    id: `legacy-${contextUsage.contextWindow}-${usedTokens}-${contextUsage.outputTokens}`,
    capturedAt,
    phase: "settled",
    source: "legacy",
    model: null,
    usedTokens,
    contextWindow: contextUsage.contextWindow,
    percent: Math.min(100, (usedTokens / contextUsage.contextWindow) * 100),
    breakdown: {
      systemPromptTokens: 0,
      toolTokens: 0,
      conversationTokens: usedTokens,
      freeTokens: Math.max(0, contextUsage.contextWindow - usedTokens),
      reservedOutputTokens: 0,
    },
  };
}

export function contextUsageFromPiSnapshot(snapshot: PiContextSnapshot): ContextUsage {
  return {
    inputTokens: snapshot.usedTokens ?? 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextWindow: snapshot.contextWindow,
  };
}

export function piContextSummaryMessage(snapshot: PiContextSnapshot): SummaryUIMessage | null {
  if (snapshot.phase !== "compacted" || !snapshot.compaction) return null;
  return {
    id: `pi-context-compaction-${snapshot.id}`,
    role: "summary",
    content: snapshot.compaction.summary ?? "",
    timestamp: snapshot.capturedAt,
    compactTrigger: snapshot.compaction.reason === "manual" ? "manual" : "auto",
    ...(snapshot.compaction.tokensBefore !== null
      ? { compactPreTokens: snapshot.compaction.tokensBefore }
      : {}),
  };
}
