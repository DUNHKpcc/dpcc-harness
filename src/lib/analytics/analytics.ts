/**
 * Legacy call-site shims retained while feature-specific code is removed.
 * They deliberately do not collect, persist, or transmit any data.
 */
import { extractErrorDetails, sanitizeErrorContext } from "@shared/lib/error-utils";

export function capture(_event: string, _properties?: Record<string, unknown>): void {}

export function captureException(error: Error, properties?: Record<string, unknown>): void {
  console.error("[renderer-error]", {
    ...(sanitizeErrorContext(properties) ?? {}),
    error: extractErrorDetails(error),
  });
}

/** Log a renderer error and return its message for UI state. */
export function reportError(
  label: string,
  err: unknown,
  context?: Record<string, unknown>,
): string {
  const details = extractErrorDetails(err);
  console.error(`[${label}]`, {
    ...(sanitizeErrorContext(context) ?? {}),
    error: details,
  });
  return details.message;
}
