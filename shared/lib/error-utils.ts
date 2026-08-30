/** Shared, bounded error details for renderer and main-process boundaries. */

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 4_000;
const MAX_CONTEXT_DEPTH = 4;
const MAX_CONTEXT_ENTRIES = 32;

export interface ExtractedErrorDetails {
  message: string;
  name?: string;
  code?: string | number;
  status?: number;
  statusText?: string;
  cause?: string;
  stack?: string;
}

function clip(value: string, max: number): string {
  const normalized = value.trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)\s*[:=]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:access_token|refresh_token|api_key|token|secret|code)=)[^&#\s]+/gi, "$1[REDACTED]");
}

function safeText(value: unknown, max = MAX_MESSAGE_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = clip(redactSecrets(value), max);
  return text || undefined;
}

function isSensitiveKey(key: string): boolean {
  return /authorization|cookie|password|secret|token|api[_-]?key|credential/i.test(key);
}

function sanitizeContextValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return safeText(value);
  if (value instanceof Error) return extractErrorDetails(value);
  if (depth >= MAX_CONTEXT_DEPTH) return "[Truncated]";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CONTEXT_ENTRIES)
      .map((item) => sanitizeContextValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_CONTEXT_ENTRIES)
        .map(([key, item]) => [
          key,
          isSensitiveKey(key) ? "[REDACTED]" : sanitizeContextValue(item, depth + 1),
        ]),
    );
  }
  return safeText(serializeFallback(value));
}

/** Bound and redact caller-supplied fields before writing diagnostic logs. */
export function sanitizeErrorContext(
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return sanitizeContextValue(context, 0) as Record<string, unknown>;
}

function safeCode(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim()) return safeText(value, 160);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function safeStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function serializeFallback(value: unknown): string {
  try {
    // Serialize a plain, bounded copy rather than the caller's raw object.
    // This keeps fallback diagnostics useful without bypassing key-based
    // credential redaction or invoking an untrusted toJSON implementation.
    const serializable = Array.isArray(value) || isRecord(value)
      ? sanitizeContextValue(value, 0)
      : value;
    const serialized = JSON.stringify(serializable);
    if (typeof serialized === "string" && serialized !== "{}") return serialized;
  } catch {
    // Circular or hostile values are handled by String below.
  }
  try {
    return String(value);
  } catch {
    return "Unknown error";
  }
}

function nestedError(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!isRecord(value) || depth > 5) return undefined;
  if (typeof value.message === "string") return value;
  const candidates = [value.error, value.response, value.data, value.details, value.body];
  for (const candidate of candidates) {
    const found = nestedError(candidate, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function nestedField(value: unknown, keys: string[], depth = 0): unknown {
  if (!isRecord(value) || depth > 5) return undefined;
  for (const key of keys) {
    if (value[key] !== undefined) return value[key];
  }
  for (const candidate of [value.error, value.response, value.data, value.details, value.body]) {
    const found = nestedField(candidate, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function extractErrorDetailsInternal(
  err: unknown,
  seen: WeakSet<object>,
  depth: number,
): ExtractedErrorDetails {
  if (depth > 8) return { message: "Nested error cause truncated" };
  if (typeof err === "string") return { message: safeText(err) ?? "Unknown error" };

  if (err instanceof Error) {
    if (seen.has(err)) return { message: "Circular error reference" };
    seen.add(err);
    const record = err as Error & Record<string, unknown>;
    const causeDetails = record.cause === undefined
      ? undefined
      : extractErrorDetailsInternal(record.cause, seen, depth + 1);
    const message = safeText(err.message) ?? "Unknown error";
    const name = safeText(err.name, 160);
    const code = safeCode(record.code);
    const status = safeStatus(record.status ?? record.statusCode);
    const statusText = safeText(record.statusText, 300);
    const stack = safeText(err.stack, MAX_STACK_LENGTH);
    return {
      message,
      ...(name ? { name } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(statusText ? { statusText } : {}),
      ...(causeDetails?.message && causeDetails.message !== message ? { cause: causeDetails.message } : {}),
      ...(stack ? { stack } : {}),
    };
  }

  if (isRecord(err)) {
    if (seen.has(err)) return { message: "Circular error reference" };
    seen.add(err);
    const nested = nestedError(err);
    const source = nested ?? err;
    const nestedCause = source.cause === undefined
      ? undefined
      : extractErrorDetailsInternal(source.cause, seen, depth + 1);
    const message = safeText(source.message)
      ?? safeText(source.stderr)
      ?? safeText(source.stdout)
      ?? (nested && nested !== err ? safeText(err.message) : undefined)
      ?? safeText(serializeFallback(err))
      ?? "Unknown error";
    const name = safeText(source.name, 160);
    const code = safeCode(source.code);
    const status = safeStatus(nestedField(err, ["status", "statusCode"]));
    const statusText = safeText(source.statusText, 300);
    const stack = safeText(source.stack, MAX_STACK_LENGTH);
    return {
      message,
      ...(name ? { name } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(statusText ? { statusText } : {}),
      ...(nestedCause?.message && nestedCause.message !== message ? { cause: nestedCause.message } : {}),
      ...(stack ? { stack } : {}),
    };
  }

  return { message: safeText(serializeFallback(err)) ?? "Unknown error" };
}

/** Extract structured, bounded details without depending on Electron or a logger. */
export function extractErrorDetails(err: unknown): ExtractedErrorDetails {
  return extractErrorDetailsInternal(err, new WeakSet<object>(), 0);
}

/** Keep the historical string API for IPC responses and UI fallbacks. */
export function extractErrorMessage(err: unknown): string {
  return extractErrorDetails(err).message;
}
