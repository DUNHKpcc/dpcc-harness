/**
 * Renderer-facing context telemetry emitted by the bundled Pi extension.
 * It excludes prompts and tool arguments; Pi may include its own compacted
 * session summary so the user can inspect what changed.
 */
export type PiContextSnapshotPhase =
  | "session_start"
  | "request"
  | "settled"
  | "compacting"
  | "compacted";

export type PiContextCompactionReason = "manual" | "threshold" | "overflow" | "unknown";

export interface PiContextBreakdown {
  systemPromptTokens: number;
  toolTokens: number;
  conversationTokens: number;
  freeTokens: number;
  reservedOutputTokens: number;
}

export interface PiContextCompaction {
  reason: PiContextCompactionReason;
  tokensBefore: number | null;
  summary?: string;
}

/** A bounded description of the system prompt without its source text. */
export interface PiContextSystemPromptDetails {
  characterCount: number;
  tokenEstimate: number;
}

/** An active Pi tool visible to the current model. */
export interface PiContextToolDetails {
  name: string;
  description: string | null;
  tokenEstimate: number;
}

export type PiContextTimelineKind =
  | "user"
  | "assistant"
  | "tool"
  | "compaction"
  | "branch_summary"
  | "custom"
  | "other";

/** A context-bearing session entry, with a bounded safe-to-render excerpt. */
export interface PiContextTimelineEntry {
  id: string;
  kind: PiContextTimelineKind;
  label: string | null;
  timestamp: number | null;
  tokenEstimate: number;
  characterCount: number;
  excerpt: string | null;
  excerptTruncated: boolean;
}

/**
 * The inspectable composition of Pi's current context.
 *
 * These values are estimates derived from Pi-visible state. System prompt
 * source text and tool arguments are deliberately not forwarded to the
 * renderer.
 */
export interface PiContextDetails {
  systemPrompt: PiContextSystemPromptDetails;
  tools: PiContextToolDetails[];
  totalTools: number;
  omittedTools: number;
  timeline: PiContextTimelineEntry[];
  totalEntries: number;
  omittedEntries: number;
}

export interface PiContextSnapshot {
  version: 1;
  id: string;
  capturedAt: number;
  phase: PiContextSnapshotPhase;
  source: "pi-extension" | "legacy";
  model: string | null;
  usedTokens: number | null;
  contextWindow: number;
  percent: number | null;
  breakdown: PiContextBreakdown;
  compaction?: PiContextCompaction;
  details?: PiContextDetails;
}
