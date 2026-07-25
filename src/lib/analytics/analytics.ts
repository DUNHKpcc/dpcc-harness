/**
 * Legacy call-site shims retained while feature-specific code is removed.
 * They deliberately do not collect, persist, or transmit any data.
 */
export function capture(_event: string, _properties?: Record<string, unknown>): void {}

export function captureException(_error: Error, _properties?: Record<string, unknown>): void {}

/** Log a renderer error and return its message for UI state. */
export function reportError(
  label: string,
  err: unknown,
  _context?: Record<string, unknown>,
): string {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${label}]`, err);
  return message;
}
