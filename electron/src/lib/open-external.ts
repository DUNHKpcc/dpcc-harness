import { shell } from "electron";
import { reportError } from "./error-utils";

const DEFAULT_ALLOWED_EXTERNAL_PROTOCOLS = ["http:", "https:", "mailto:"] as const;

export function normalizeExternalUrl(
  value: string | URL,
  allowedProtocols: readonly string[] = DEFAULT_ALLOWED_EXTERNAL_PROTOCOLS,
): string | null {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return allowedProtocols.includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function openExternalUrl(
  value: string | URL,
  options: {
    allowedProtocols?: readonly string[];
    logLabel?: string;
  } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = normalizeExternalUrl(value, options.allowedProtocols);
  if (!normalized) {
    const rawUrl = value.toString();
    const message = `Blocked unsafe external URL: ${rawUrl}`;
    reportError(options.logLabel ?? "OPEN_EXTERNAL_BLOCKED", new Error(message), { url: rawUrl });
    return { ok: false, error: message };
  }

  const openExternal = shell.openExternal.bind(shell);
  try {
    await openExternal(normalized);
    return { ok: true };
  } catch (err) {
    const message = reportError("OPEN_EXTERNAL_ERR", err, { url: normalized });
    return { ok: false, error: message };
  }
}
