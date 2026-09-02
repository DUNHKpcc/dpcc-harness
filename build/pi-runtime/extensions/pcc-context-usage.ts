/*
 * PccAgent Pi context observability bridge.
 *
 * Context accounting is adapted from the stable pi-context-usage v1.0.2
 * project (championswimmer/pi-context-usage, ISC declared in package metadata),
 * but this extension is intentionally PccAgent-owned and read-only: it never
 * changes messages, tool state, or Pi compaction policy.
 *
 * The bridge sends composition metadata, not raw provider input. System prompt
 * source text, tool arguments/results, and reasoning text are never forwarded.
 */

const BRIDGE_PREFIX = "__PCC_AGENT_PI_CONTEXT_V1__:";
const MAX_SUMMARY_LENGTH = 6_000;
const MAX_BRIDGE_PAYLOAD_LENGTH = 20_000;
const MAX_DETAIL_TOOLS = 18;
const MAX_DETAIL_ENTRIES = 40;
const MAX_TOOL_DESCRIPTION_LENGTH = 220;
const MAX_ENTRY_EXCERPT_LENGTH = 240;

type SnapshotPhase = "session_start" | "request" | "settled" | "compacting" | "compacted";
type TimelineKind = "user" | "assistant" | "tool" | "compaction" | "branch_summary" | "custom" | "other";
type UnknownRecord = Record<string, unknown>;

interface ContextToolDetails {
  name: string;
  description: string | null;
  tokenEstimate: number;
}

interface ContextTimelineEntry {
  id: string;
  kind: TimelineKind;
  label: string | null;
  timestamp: number | null;
  tokenEstimate: number;
  characterCount: number;
  excerpt: string | null;
  excerptTruncated: boolean;
}

interface ContextDetails {
  systemPrompt: {
    characterCount: number;
    tokenEstimate: number;
  };
  tools: ContextToolDetails[];
  totalTools: number;
  omittedTools: number;
  timeline: ContextTimelineEntry[];
  totalEntries: number;
  omittedEntries: number;
}

interface SnapshotPayload {
  version: 1;
  id: string;
  capturedAt: number;
  phase: SnapshotPhase;
  model: string | null;
  usedTokens: number | null;
  contextWindow: number;
  breakdown: {
    systemPromptTokens: number;
    toolTokens: number;
    conversationTokens: number;
    freeTokens: number;
    reservedOutputTokens: number;
  };
  compaction?: UnknownRecord;
  details?: ContextDetails;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function estimateTokens(value: unknown): number {
  try {
    return Math.ceil(JSON.stringify(value).length / 4);
  } catch {
    return 0;
  }
}

function estimateTextTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function compactReason(value: unknown): "manual" | "threshold" | "overflow" | "unknown" {
  return value === "manual" || value === "threshold" || value === "overflow"
    ? value
    : "unknown";
}

function modelName(context: UnknownRecord): string | null {
  const model = asRecord(context.model);
  if (!model) return null;
  const provider = text(model.provider);
  const id = text(model.id);
  return provider && id ? `${provider}/${id}` : id ?? provider;
}

function activeTools(pi: UnknownRecord): UnknownRecord[] {
  const all = typeof pi.getAllTools === "function" ? pi.getAllTools() : [];
  if (!Array.isArray(all)) return [];
  const tools = all.map(asRecord).filter((tool): tool is UnknownRecord => tool !== null);
  const active = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : [];
  if (!Array.isArray(active) || active.length === 0) return tools;
  const activeNames = new Set(active.filter((value): value is string => typeof value === "string"));
  return tools.filter((tool) => typeof tool.name === "string" && activeNames.has(tool.name));
}

function compactionDetails(event: unknown): UnknownRecord | undefined {
  const record = asRecord(event);
  if (!record) return undefined;
  const compactionEntry = asRecord(record.compactionEntry);
  const preparation = asRecord(record.preparation);
  const summary = text(compactionEntry?.summary ?? record.summary);
  const tokensBefore = finiteNonNegative(compactionEntry?.tokensBefore ?? preparation?.tokensBefore);
  const hasReason = record.reason === "manual" || record.reason === "threshold" || record.reason === "overflow";
  if (!summary && tokensBefore === null && !hasReason) return undefined;
  return {
    reason: compactReason(record.reason),
    tokensBefore,
    ...(summary ? { summary: summary.slice(0, MAX_SUMMARY_LENGTH) } : {}),
  };
}

function safeSystemPrompt(context: UnknownRecord): string {
  if (typeof context.getSystemPrompt !== "function") return "";
  try {
    const value = (context.getSystemPrompt as () => unknown).call(context);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function contextEntries(context: UnknownRecord): UnknownRecord[] {
  const sessionManager = asRecord(context.sessionManager);
  if (!sessionManager) return [];
  const getEntries = typeof sessionManager.buildContextEntries === "function"
    ? sessionManager.buildContextEntries
    : sessionManager.getBranch;
  if (typeof getEntries !== "function") return [];
  try {
    const entries = (getEntries as () => unknown).call(sessionManager);
    return Array.isArray(entries)
      ? entries.map(asRecord).filter((entry): entry is UnknownRecord => entry !== null)
      : [];
  } catch {
    return [];
  }
}

function toTimestamp(value: unknown): number | null {
  const numeric = finiteNonNegative(value);
  if (numeric !== null) return numeric;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map(asRecord)
    .filter((part): part is UnknownRecord => part !== null && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

function contentCharacterCount(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (!Array.isArray(value)) return 0;
  return value.reduce((count, item) => {
    const part = asRecord(item);
    return count + (typeof part?.text === "string" ? part.text.length : 0);
  }, 0);
}

function excerpt(value: string): { excerpt: string | null; excerptTruncated: boolean } {
  const trimmed = value.trim();
  if (!trimmed) return { excerpt: null, excerptTruncated: false };
  return {
    excerpt: trimmed.slice(0, MAX_ENTRY_EXCERPT_LENGTH),
    excerptTruncated: trimmed.length > MAX_ENTRY_EXCERPT_LENGTH,
  };
}

function entryId(entry: UnknownRecord, index: number): string {
  return text(entry.id)?.slice(0, 180) ?? `entry-${index}`;
}

function timelineEntry(entry: UnknownRecord, index: number): ContextTimelineEntry {
  const type = text(entry.type) ?? "other";
  const base = {
    id: entryId(entry, index),
    timestamp: toTimestamp(entry.timestamp),
    tokenEstimate: estimateTokens(entry),
  };

  if (type === "message") {
    const message = asRecord(entry.message);
    const role = text(message?.role);
    const content = message?.content;
    const characterCount = contentCharacterCount(content);
    if (role === "user" || role === "assistant") {
      const safeText = textContent(content);
      const preview = excerpt(safeText);
      return {
        ...base,
        kind: role,
        label: null,
        characterCount,
        ...preview,
      };
    }
    if (role === "toolResult") {
      const toolName = text(message?.toolName) ?? text(message?.name);
      return {
        ...base,
        kind: "tool",
        label: toolName ? `Tool: ${toolName}` : "Tool result",
        characterCount,
        excerpt: null,
        excerptTruncated: false,
      };
    }
    return {
      ...base,
      kind: "other",
      label: role ?? "Message",
      characterCount,
      excerpt: null,
      excerptTruncated: false,
    };
  }

  if (type === "compaction" || type === "branch_summary") {
    const summary = typeof entry.summary === "string" ? entry.summary : "";
    return {
      ...base,
      kind: type,
      label: null,
      characterCount: summary.length,
      ...excerpt(summary),
    };
  }

  if (type === "custom" || type === "custom_message") {
    return {
      ...base,
      kind: "custom",
      label: text(entry.customType) ?? "Extension entry",
      characterCount: 0,
      excerpt: null,
      excerptTruncated: false,
    };
  }

  return {
    ...base,
    kind: "other",
    label: type,
    characterCount: 0,
    excerpt: null,
    excerptTruncated: false,
  };
}

function contextDetails(pi: UnknownRecord, context: UnknownRecord, systemPrompt: string): ContextDetails {
  const tools = activeTools(pi);
  const visibleTools = tools.slice(0, MAX_DETAIL_TOOLS).map((tool): ContextToolDetails => ({
    name: text(tool.name)?.slice(0, 240) ?? "Unnamed tool",
    description: text(tool.description)?.slice(0, MAX_TOOL_DESCRIPTION_LENGTH) ?? null,
    tokenEstimate: estimateTokens(tool),
  }));
  const entries = contextEntries(context);
  const visibleEntries = entries.slice(-MAX_DETAIL_ENTRIES);
  const timeline = visibleEntries.map(timelineEntry);

  return {
    systemPrompt: {
      characterCount: systemPrompt.length,
      tokenEstimate: estimateTextTokens(systemPrompt),
    },
    tools: visibleTools,
    totalTools: tools.length,
    omittedTools: Math.max(0, tools.length - visibleTools.length),
    timeline,
    totalEntries: entries.length,
    omittedEntries: Math.max(0, entries.length - timeline.length),
  };
}

function cloneDetails(details: ContextDetails): ContextDetails {
  return {
    systemPrompt: { ...details.systemPrompt },
    tools: details.tools.map((tool) => ({ ...tool })),
    totalTools: details.totalTools,
    omittedTools: details.omittedTools,
    timeline: details.timeline.map((entry) => ({ ...entry })),
    totalEntries: details.totalEntries,
    omittedEntries: details.omittedEntries,
  };
}

function serializeSnapshot(snapshot: SnapshotPayload): string {
  const details = snapshot.details ? cloneDetails(snapshot.details) : undefined;
  const candidate: SnapshotPayload = { ...snapshot, ...(details ? { details } : {}) };
  let serialized = JSON.stringify(candidate);

  while (serialized.length > MAX_BRIDGE_PAYLOAD_LENGTH && candidate.details?.timeline.length) {
    candidate.details.timeline.shift();
    candidate.details.omittedEntries += 1;
    serialized = JSON.stringify(candidate);
  }
  while (serialized.length > MAX_BRIDGE_PAYLOAD_LENGTH && candidate.details?.tools.length) {
    candidate.details.tools.pop();
    candidate.details.omittedTools += 1;
    serialized = JSON.stringify(candidate);
  }
  if (serialized.length > MAX_BRIDGE_PAYLOAD_LENGTH && candidate.details) {
    const { details: _details, ...withoutDetails } = candidate;
    serialized = JSON.stringify(withoutDetails);
  }
  return serialized;
}

async function emitSnapshot(
  pi: UnknownRecord,
  context: UnknownRecord,
  phase: SnapshotPhase,
  sequence: number,
  compaction?: UnknownRecord,
): Promise<void> {
  const getContextUsage = typeof context.getContextUsage === "function"
    ? context.getContextUsage as () => unknown
    : null;
  const usage = phase === "compacted" ? null : asRecord(getContextUsage?.call(context));
  const model = asRecord(context.model);
  const contextWindow = finiteNonNegative(usage?.contextWindow ?? model?.contextWindow);
  if (!contextWindow) return;

  const usedTokens = usage?.tokens === null
    ? null
    : finiteNonNegative(usage?.tokens);
  const systemPrompt = safeSystemPrompt(context);
  const toolTokens = estimateTokens(activeTools(pi));
  const systemPromptTokens = estimateTextTokens(systemPrompt);
  const reservedOutputTokens = finiteNonNegative(model?.maxTokens) ?? 0;
  const conversationTokens = usedTokens === null
    ? 0
    : Math.max(0, usedTokens - systemPromptTokens - toolTokens);
  const freeTokens = usedTokens === null
    ? contextWindow
    : Math.max(0, contextWindow - usedTokens - reservedOutputTokens);
  const shouldIncludeDetails = phase === "session_start" || phase === "settled" || phase === "compacted";
  const snapshot: SnapshotPayload = {
    version: 1,
    id: `pcc-context-${Date.now()}-${sequence}`,
    capturedAt: Date.now(),
    phase,
    model: modelName(context),
    usedTokens,
    contextWindow,
    breakdown: {
      systemPromptTokens,
      toolTokens,
      conversationTokens,
      freeTokens,
      reservedOutputTokens,
    },
    ...(compaction ? { compaction } : {}),
    ...(shouldIncludeDetails ? { details: contextDetails(pi, context, systemPrompt) } : {}),
  };

  const ui = asRecord(context.ui);
  if (typeof ui?.notify !== "function") return;
  await ui.notify(`${BRIDGE_PREFIX}${serializeSnapshot(snapshot)}`, "info");
}

export default function installPccContextUsage(api: unknown): void {
  const pi = asRecord(api);
  if (!pi || typeof pi.on !== "function") return;
  let sequence = 0;
  const emit = async (
    phase: SnapshotPhase,
    contextValue: unknown,
    event?: unknown,
  ) => {
    const context = asRecord(contextValue);
    if (!context) return;
    try {
      await emitSnapshot(pi, context, phase, sequence++, event ? compactionDetails(event) : undefined);
    } catch {
      // Context telemetry must never affect the Pi turn or compaction result.
    }
  };

  pi.on("session_start", (event: unknown, context: unknown) => emit("session_start", context, event));
  pi.on("before_provider_request", (event: unknown, context: unknown) => emit("request", context, event));
  pi.on("agent_settled", (event: unknown, context: unknown) => emit("settled", context, event));
  pi.on("session_before_compact", (event: unknown, context: unknown) => emit("compacting", context, event));
  pi.on("session_compact", (event: unknown, context: unknown) => emit("compacted", context, event));
}
