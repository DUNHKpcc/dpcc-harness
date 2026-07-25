/**
 * Shared error message extraction utility.
 *
 * Handles Error instances, structured objects with .message or .stderr,
 * strings, and unknown values. Used across all session IPC handlers.
 */

import { log } from "./logger";

export { extractErrorMessage } from "@shared/lib/error-utils";
import { extractErrorMessage } from "@shared/lib/error-utils";

/**
 * Log an error with a consistent label.
 *
 * Replaces the common `log(label, extractErrorMessage(err))` pattern with
 * a single call.
 *
 * @returns The extracted error message string (for use in IPC responses).
 */
export function reportError(
  label: string,
  err: unknown,
  _context?: Record<string, unknown>,
): string {
  const message = extractErrorMessage(err);
  log(label, message);

  return message;
}
