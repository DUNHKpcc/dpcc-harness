/** Shared guards for generated and persisted session titles. */

export const PI_CONTEXT_BRIDGE_PREFIX = "__PCC_AGENT_PI_CONTEXT_V1__:";

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function lastNonEmptyLine(text: string): string | undefined {
  const lines = text.split(/\r?\n/g);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function localSessionTitle(message: string): string {
  const normalized = (firstNonEmptyLine(message) ?? "New chat")
    .replace(/\s+/g, " ")
    .replace(/[.!?。！？]+$/g, "")
    .trim();
  if (normalized.length <= 48) return normalized || "New chat";
  return `${normalized.slice(0, 45).trimEnd()}...`;
}

function unwrapTitle(candidate: string): string {
  let value = candidate.trim();
  for (let pass = 0; pass < 2; pass += 1) {
    value = value
      .replace(/^(?:title|标题)\s*:\s*/i, "")
      .replace(/^(?:[*`#"'“”‘’]+)|(?:[*`#"'“”‘’]+)$/g, "")
      .trim();
  }
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeStructuredData(value: string): boolean {
  if (!/^[\[{]/.test(value)) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function looksLikeStructuredDataFragment(value: string): boolean {
  return /^(?:["']?(?:version|id|capturedAt|phase|model|usedTokens|contextWindow|breakdown|details|timeline|systemPrompt|tools|freeTokens|reservedOutputTokens)["']?\s*:|[}\]],?\s*$)/.test(value);
}

function isUnsafeGeneratedTitle(value: string): boolean {
  return value.includes(PI_CONTEXT_BRIDGE_PREFIX)
    || value.includes("_meta")
    || /[\u0000-\u001f\u007f\ufffd]/u.test(value)
    || looksLikeStructuredData(value)
    || looksLikeStructuredDataFragment(value)
    || /^(?:pi\s+(?:notification|info)|retrying\b)/i.test(value);
}

/**
 * Accept only a compact human-readable title. Any protocol, JSON, control
 * character, or bridge payload is rejected so callers can use the user text
 * fallback instead of persisting diagnostic output.
 */
export function normalizeGeneratedSessionTitle(
  responseText: string,
  fallbackMessage: string,
): string {
  const candidate = unwrapTitle(lastNonEmptyLine(responseText) ?? "");
  if (!candidate || candidate.length > 80 || isUnsafeGeneratedTitle(candidate)) {
    return localSessionTitle(fallbackMessage);
  }
  return candidate;
}

export function normalizePersistedSessionTitle(
  title: unknown,
  fallback = "Untitled",
): string {
  if (typeof title !== "string") return fallback;
  const candidate = unwrapTitle(title);
  if (!candidate || isUnsafeGeneratedTitle(candidate)) return fallback;
  return candidate;
}
