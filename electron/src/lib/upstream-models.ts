/**
 * Lists model ids from an OpenAI-compatible `/v1/models` endpoint. Shared by the
 * account panel (DPCC account models) and the Current Config panel (per-engine
 * effective-upstream models).
 */

import { extractErrorMessage } from "./error-utils";

const REQUEST_TIMEOUT_MS = 8_000;

/** Normalize to a host root with no trailing slash or `/v1` suffix. */
export function normalizeModelsRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** GET {root}/v1/models with a bearer token. Returns ids + an error string on failure. */
export async function fetchUpstreamModels(
  baseUrl: string,
  token: string,
): Promise<{ models: string[]; error: string | null }> {
  const root = normalizeModelsRoot(baseUrl);
  if (!root) return { models: [], error: "no_endpoint" };
  if (!token) return { models: [], error: "no_token" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${root}/v1/models`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return { models: [], error: `${res.status} ${res.statusText}` };
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    if (!Array.isArray(body.data)) return { models: [], error: "invalid_response" };
    const models = body.data
      .map((m) => (typeof m?.id === "string" ? m.id : ""))
      .filter(Boolean);
    return { models, error: null };
  } catch (e) {
    return { models: [], error: extractErrorMessage(e) };
  } finally {
    clearTimeout(timeout);
  }
}
