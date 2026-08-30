import { log } from "./logger";

export { extractErrorDetails, extractErrorMessage, sanitizeErrorContext } from "@shared/lib/error-utils";
import { extractErrorDetails, sanitizeErrorContext } from "@shared/lib/error-utils";

/**
 * @returns The extracted error message string (for use in IPC responses).
 */
export function reportError(
  label: string,
  err: unknown,
  context?: Record<string, unknown>,
): string {
  const details = extractErrorDetails(err);
  const safeContext = sanitizeErrorContext(context);
  log(label, {
    ...(safeContext ?? {}),
    error: details,
  });

  return details.message;
}
