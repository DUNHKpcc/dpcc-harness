import {
  BUILTIN_PI_AGENT_ID,
} from "../types/registry";
import type { PersistedEngineId, RuntimeEngineId } from "../types/engine";

export { BUILTIN_PI_AGENT_ID } from "../types/registry";

export interface SessionRuntimeIdentity {
  engine: RuntimeEngineId;
  agentId: string;
}

export type SessionRuntimeDisposition =
  | { kind: "runtime"; engine: "acp"; agentId: string }
  | { kind: "legacy-read-only"; engine: "claude" | "codex" }
  | { kind: "invalid"; engine: string; errorCode: "session_invalid_engine" };

export const LEGACY_SESSION_READ_ONLY_MESSAGE =
  "This session uses a removed runtime and is read-only. Create a new Pi session to continue.";
export const INVALID_SESSION_ENGINE_MESSAGE =
  "This session has an unsupported engine value and cannot be started. The original history is preserved.";

export function isPersistedEngineId(value: unknown): value is PersistedEngineId {
  return value === "acp" || value === "claude" || value === "codex";
}

export function isRuntimeSessionDisposition(
  disposition: SessionRuntimeDisposition,
): disposition is Extract<SessionRuntimeDisposition, { kind: "runtime" }> {
  return disposition.kind === "runtime";
}

export function isLegacyReadOnlyDisposition(
  disposition: SessionRuntimeDisposition,
): disposition is Extract<SessionRuntimeDisposition, { kind: "legacy-read-only" }> {
  return disposition.kind === "legacy-read-only";
}

export function newPiSessionIdentity(): SessionRuntimeIdentity {
  return { engine: "acp", agentId: BUILTIN_PI_AGENT_ID };
}

export function getSessionRuntimeDisposition(session: {
  engine?: PersistedEngineId | string | null;
  agentId?: string;
}): SessionRuntimeDisposition {
  const engine = typeof session.engine === "string" ? session.engine.trim() : session.engine;
  if (engine === "claude" || engine === "codex") {
    return { kind: "legacy-read-only", engine };
  }
  if (engine === "acp") {
    return {
      kind: "runtime",
      engine: "acp",
      agentId: session.agentId?.trim() || BUILTIN_PI_AGENT_ID,
    };
  }

  // Sessions written before the engine field was introduced are historical
  // Claude/import records. Preserve their data, but never guess a live runtime.
  if (engine === undefined || engine === null) {
    return { kind: "legacy-read-only", engine: "claude" };
  }

  return {
    kind: "invalid",
    engine: String(engine),
    errorCode: "session_invalid_engine",
  };
}

export function canUseSessionRuntime(session: {
  engine?: PersistedEngineId | string;
  agentId?: string;
}): boolean {
  return isRuntimeSessionDisposition(getSessionRuntimeDisposition(session));
}

/**
 * Normalize only creation options. Persisted sessions must go through
 * getSessionRuntimeDisposition instead, so historical data is never rewritten.
 */
export function normalizeNewSessionIdentity(options?: {
  engine?: string;
  agentId?: string;
}): SessionRuntimeIdentity {
  const agentId = options?.engine === "acp" ? options.agentId?.trim() : "";
  return { engine: "acp", agentId: agentId || BUILTIN_PI_AGENT_ID };
}
