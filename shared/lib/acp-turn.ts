import { extractErrorMessage } from "./error-utils";
import {
  ACP_STOP_REASONS,
  type ACPCompletedStopReason,
  type ACPErrorDetails,
  type ACPErrorStage,
  type ACPPromptResult,
  type ACPStopReason,
  type ACPPiTurnOutcome,
  type ACPTurnStatus,
} from "../types/acp";

/**
 * pi-acp currently serializes retry lifecycle events as fixed text. Keep this
 * matrix explicit: a new adapter must fail closed until its event shape has
 * been reviewed and added here.
 */
export const PI_ACP_SUPPORTED_ADAPTER_VERSIONS = ["0.0.33"] as const;

const RETRY_ATTEMPT_RE = /^Retrying\s*\(attempt\s+\d+\/\d+,\s*waiting\s+\d+s\)\.\.\.$/i;
const RETRY_START_RE = /^Retrying\.\.\.$/i;
const RETRY_FINISHED_RE = /^Retry finished, resuming\.$/i;
const RETRY_NOTICE_RE = /Retrying(?:\s*\(attempt\s+\d+\/\d+,\s*waiting\s+\d+s\))?\.\.\.|Retry finished, resuming\./gi;
const PI_STARTUP_BANNER_RE = /^pi v\d+\.\d+\.\d+(?:[-+][\w.-]+)?\s*\r?\n---\s*$/i;

export interface ACPTurnObservation {
  retryNoticeCount: number;
  meaningfulTextLength: number;
  toolCallCount: number;
  /** Kept as a compatibility alias for older callers/tests. */
  sawToolCall: boolean;
  sawThought: boolean;
  structuredError?: ACPErrorDetails;
}

/** Internal classifier output, before a stable turn ID is attached. */
export interface ACPTurnOutcome {
  status: ACPTurnStatus;
  stopReason?: ACPStopReason;
  error?: ACPErrorDetails;
}

export function createAcpTurnObservation(): ACPTurnObservation {
  return {
    retryNoticeCount: 0,
    meaningfulTextLength: 0,
    toolCallCount: 0,
    sawToolCall: false,
    sawThought: false,
  };
}

function normalizeAdapterVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/(?:pi-acp@)?(\d+\.\d+\.\d+)/i);
  return match?.[1];
}

export function isSupportedPiAcpAdapterVersion(value: unknown): boolean {
  const normalized = normalizeAdapterVersion(value);
  return normalized != null
    && (PI_ACP_SUPPORTED_ADAPTER_VERSIONS as readonly string[]).includes(normalized);
}

function countRetryNotices(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (RETRY_START_RE.test(trimmed) || RETRY_ATTEMPT_RE.test(trimmed) || RETRY_FINISHED_RE.test(trimmed)) return 1;

  const matches = trimmed.match(RETRY_NOTICE_RE);
  if (!matches) return 0;
  const remainder = trimmed.replace(RETRY_NOTICE_RE, "").trim();
  return remainder ? 0 : matches.length;
}

/** Returns true only for adapter-generated retry status, not arbitrary model text. */
export function isPiRetryNotice(text: string): boolean {
  return countRetryNotices(text) > 0;
}

/** The reviewed adapter emits this transport banner asynchronously after session/new. */
export function isPiStartupBanner(text: string): boolean {
  return PI_STARTUP_BANNER_RE.test(text.trim());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isErrorStage(value: unknown): value is ACPErrorStage {
  return value === "spawn"
    || value === "initialize"
    || value === "authenticate"
    || value === "prompt"
    || value === "settle"
    || value === "persist";
}

function readStructuredDiagnostic(record: Record<string, unknown>): {
  retry: boolean;
  error?: ACPErrorDetails;
} {
  // Only adapter-owned metadata can change turn semantics. Never inspect
  // arbitrary model text for these fields.
  const metadata = [record._meta, record.meta, record.metadata, record.pi]
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item != null);
  let retry = false;
  let error: ACPErrorDetails | undefined;

  for (const item of metadata) {
    const retryValue = item.retry ?? item.autoRetry ?? item.auto_retry;
    if (retryValue === true || asRecord(retryValue)?.active === true) retry = true;

    const errorValue = asRecord(item.error) ?? asRecord(item.failure);
    const message = typeof errorValue?.message === "string"
      ? errorValue.message
      : typeof item.errorMessage === "string"
        ? item.errorMessage
        : undefined;
    if (message) {
      error = {
        code: typeof errorValue?.code === "string" ? errorValue.code : "pi_structured_error",
        message,
        source: errorValue?.source === "upstream" || errorValue?.source === "pi"
          ? errorValue.source
          : "pi",
        stage: isErrorStage(errorValue?.stage) ? errorValue.stage : "prompt",
        retryable: typeof errorValue?.retryable === "boolean" ? errorValue.retryable : true,
        ...(typeof errorValue?.cause === "string" ? { cause: errorValue.cause } : {}),
      };
    }
  }

  return { retry, error };
}

export function observeAcpTurnUpdate(
  observation: ACPTurnObservation,
  update: unknown,
  options: {
    isPi?: boolean;
    adapterVersion?: string;
  } = {},
): { diagnostic: boolean } {
  const record = asRecord(update);
  if (!record) return { diagnostic: false };

  const structured = readStructuredDiagnostic(record);
  if (structured.retry) observation.retryNoticeCount += 1;
  if (structured.error) observation.structuredError = structured.error;

  const kind = record.sessionUpdate;
  if (kind === "tool_call" || kind === "tool_call_update") {
    observation.toolCallCount += 1;
    observation.sawToolCall = true;
    return { diagnostic: false };
  }

  if (kind === "agent_thought_chunk") {
    const text = asRecord(record.content)?.text;
    if (typeof text === "string" && text.trim()) observation.sawThought = true;
    return { diagnostic: structured.retry || structured.error != null };
  }

  if (kind !== "agent_message_chunk") return { diagnostic: structured.retry || structured.error != null };
  const text = asRecord(record.content)?.text;
  if (typeof text !== "string" || !text.trim()) {
    return { diagnostic: structured.retry || structured.error != null };
  }

  // Fixed-text parsing is deliberately gated to the reviewed official adapter.
  const supportedPiAdapter = options.isPi === true
    && isSupportedPiAcpAdapterVersion(options.adapterVersion)
  const fixedStartupBanner = supportedPiAdapter && isPiStartupBanner(text);
  if (fixedStartupBanner) return { diagnostic: true };

  const fixedRetry = supportedPiAdapter && countRetryNotices(text) > 0;
  if (fixedRetry) {
    // Structured adapter metadata is authoritative. When an adapter emits
    // both metadata and its legacy text mirror, count the turn once rather
    // than inflating retry telemetry.
    if (!structured.retry) observation.retryNoticeCount += countRetryNotices(text);
    return { diagnostic: true };
  }

  observation.meaningfulTextLength += text.trim().length;
  return { diagnostic: structured.retry || structured.error != null };
}

function isValidStopReason(value: unknown): value is ACPStopReason {
  return typeof value === "string" && (ACP_STOP_REASONS as readonly string[]).includes(value);
}

function failure(
  code: string,
  message: string,
  options: Partial<ACPErrorDetails> = {},
): ACPTurnOutcome {
  return {
    status: "failed",
    error: {
      code,
      message,
      source: options.source ?? "harnss",
      stage: options.stage ?? "settle",
      retryable: options.retryable ?? false,
      ...(options.cause ? { cause: options.cause } : {}),
    },
  };
}

function isLikelyUpstreamMessage(message: string): boolean {
  return /\b(connection|network|provider|upstream|rate.?limit|timeout|unauthori[sz]ed|api key|quota|fetch)\b/i.test(message);
}

/** Convert an ACP response plus observed Pi events into the app-level outcome. */
export function classifyAcpTurn(input: {
  stopReason: unknown;
  isPi?: boolean;
  adapterVersion?: string;
  observation?: Partial<ACPTurnObservation>;
  stderrError?: unknown;
}): ACPTurnOutcome {
  const observation: ACPTurnObservation = {
    ...createAcpTurnObservation(),
    ...(input.observation ?? {}),
  };
  observation.toolCallCount = observation.toolCallCount || (observation.sawToolCall ? 1 : 0);
  observation.sawToolCall = observation.sawToolCall || observation.toolCallCount > 0;

  if (input.stopReason === "cancelled") {
    return { status: "cancelled", stopReason: "cancelled" };
  }

  if (!isValidStopReason(input.stopReason)) {
    return failure(
      "acp_invalid_stop_reason",
      `ACP returned an invalid stop reason: ${String(input.stopReason)}`,
      { source: "acp", stage: "settle", retryable: false },
    );
  }

  if (input.isPi === true && !isSupportedPiAcpAdapterVersion(input.adapterVersion)) {
    return failure(
      "pi_adapter_version_unsupported",
      "The installed pi-acp adapter version is not in Harnss' compatibility matrix.",
      { source: "pi", stage: "settle", retryable: false },
    );
  }

  const stderrMessage = input.stderrError === undefined
    ? undefined
    : extractErrorMessage(input.stderrError);
  const structuredError = observation.structuredError;
  if (structuredError && observation.meaningfulTextLength === 0 && !observation.sawToolCall) {
    return { status: "failed", error: structuredError };
  }

  const hasOnlyRetryDiagnostics = input.isPi === true
    && observation.retryNoticeCount > 0
    && observation.meaningfulTextLength === 0
    && !observation.sawToolCall;

  if (hasOnlyRetryDiagnostics) {
    return failure(
      "pi_retry_exhausted",
      stderrMessage || "Pi upstream request failed after automatic retries.",
      {
        source: stderrMessage && isLikelyUpstreamMessage(stderrMessage) ? "upstream" : "pi",
        stage: "prompt",
        retryable: true,
      },
    );
  }

  if (input.isPi === true && stderrMessage && observation.meaningfulTextLength === 0 && !observation.sawToolCall) {
    return failure(
      isLikelyUpstreamMessage(stderrMessage) ? "pi_upstream_error" : "pi_runtime_error",
      stderrMessage,
      {
        source: isLikelyUpstreamMessage(stderrMessage) ? "upstream" : "pi",
        stage: "prompt",
        retryable: true,
      },
    );
  }

  return { status: "completed", stopReason: input.stopReason as ACPCompletedStopReason };
}

/** Attach the correlation ID and normalize to the cross-layer contract. */
export function toAcpPiTurnOutcome(
  outcome: ACPTurnOutcome,
  turnId: string,
  usage?: { inputTokens?: number; outputTokens?: number } | null,
): ACPPiTurnOutcome {
  if (outcome.status === "failed") {
    return {
      status: "failed",
      turnId,
      error: outcome.error ?? {
        code: "acp_prompt_failed",
        message: "ACP prompt failed.",
        source: "acp",
        stage: "settle",
        retryable: false,
      },
    };
  }
  if (outcome.status === "cancelled") {
    return { status: "cancelled", turnId, stopReason: "cancelled" };
  }
  return {
    status: "completed",
    turnId,
    stopReason: outcome.stopReason === "cancelled" || outcome.stopReason == null
      ? "end_turn"
      : outcome.stopReason,
    ...(usage !== undefined ? { usage } : {}),
  };
}

/**
 * A prompt result can carry a terminal outcome or fail before one exists.
 * Callers must not inspect `error` without first narrowing that transport
 * branch; otherwise a completed turn is easy to mis-handle as a failure.
 */
export function getAcpPromptTransportErrorMessage(
  result: ACPPromptResult | null | undefined,
): string | undefined {
  if (!result || result.outcomeDelivered === true) return undefined;
  return result.status === "transport_error"
    ? result.error.message
    : "ACP prompt ended without delivering a terminal outcome.";
}

export function hasAcpPromptTransportEvent(
  result: ACPPromptResult | null | undefined,
): boolean {
  return result?.outcomeDelivered === false
    && result.status === "transport_error"
    && typeof result.turnId === "string"
    && result.turnId.length > 0;
}
