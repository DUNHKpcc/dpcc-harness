import type { ACPConfigSelectOption, ACPConfigSelectGroup, ACPErrorDetails } from "@/types";

function isAcpErrorDetails(value: unknown): value is ACPErrorDetails {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string"
    && record.code.trim().length > 0
    && typeof record.stage === "string"
    && record.stage.trim().length > 0
    && typeof record.message === "string"
    && record.message.trim().length > 0;
}

/** Flatten grouped or flat options into a single flat list */
export function flattenConfigOptions(
  options: ACPConfigSelectOption[] | ACPConfigSelectGroup[],
): ACPConfigSelectOption[] {
  if (options.length === 0) return [];
  if ("value" in options[0]) return options as ACPConfigSelectOption[];
  return (options as ACPConfigSelectGroup[]).flatMap((g) => g.options);
}

/** Preserve stable stage/code context when an ACP lifecycle operation fails. */
export function formatAcpOperationError(
  result: unknown,
  fallback: string,
): string {
  const record = result && typeof result === "object"
    ? result as { error?: unknown; errorDetails?: unknown }
    : {};
  const details = isAcpErrorDetails(record.errorDetails)
    ? record.errorDetails
    : undefined;
  const legacyError = typeof record.error === "string" ? record.error : undefined;
  const message = details?.message?.trim() || legacyError?.trim() || fallback;
  return details ? `[${details.stage}/${details.code}] ${message}` : message;
}
