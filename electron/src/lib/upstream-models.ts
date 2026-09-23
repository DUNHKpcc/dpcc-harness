/**
 * Lists model ids from an OpenAI-compatible `/v1/models` endpoint. Shared by the
 * account panel (DPCC account models) and the Current Config panel (per-engine
 * effective-upstream models).
 */

import { extractErrorMessage } from "./error-utils";

const REQUEST_TIMEOUT_MS = 8_000;

export type UpstreamModelErrorCode =
  | "upstream_timeout"
  | "upstream_rate_limited"
  | "upstream_bad_gateway"
  | "upstream_service_unavailable"
  | "upstream_gateway_timeout"
  | "upstream_http_error"
  | "upstream_network_error"
  | "invalid_response";

export interface UpstreamModelFetchResult {
  models: string[];
  error: string | null;
  errorCode?: UpstreamModelErrorCode;
  httpStatus?: number;
  retryAfterMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, 60_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.min(timestamp - Date.now(), 60_000));
}

/** Normalize to a host root with no trailing slash or `/v1` suffix. */
export function normalizeModelsRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** GET {root}/v1/models with a bearer token. Returns ids + an error string on failure. */
export async function fetchUpstreamModels(
  baseUrl: string,
  token: string,
): Promise<UpstreamModelFetchResult> {
  const root = normalizeModelsRoot(baseUrl);
  if (!root) return { models: [], error: "no_endpoint" };
  if (!token) return { models: [], error: "no_token" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${root}/v1/models`, {
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("retry-after") ?? null);
      const errorCode = res.status === 429
        ? "upstream_rate_limited"
        : res.status === 502
          ? "upstream_bad_gateway"
          : res.status === 503
            ? "upstream_service_unavailable"
            : res.status === 504
              ? "upstream_gateway_timeout"
              : "upstream_http_error";
      return {
        models: [],
        error: `${res.status} ${res.statusText}`,
        errorCode,
        httpStatus: res.status,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      };
    }
    const body: unknown = await res.json();
    if (!isRecord(body) || !Array.isArray(body.data)) {
      return { models: [], error: "invalid_response" };
    }
    const models = body.data
      .filter(isRecord)
      .map((model) => (typeof model.id === "string" ? model.id : ""))
      .filter(Boolean);
    return { models, error: null };
  } catch (e) {
    const timedOut = controller.signal.aborted;
    return {
      models: [],
      error: timedOut ? "Upstream model catalog request timed out" : extractErrorMessage(e),
      errorCode: timedOut ? "upstream_timeout" : "upstream_network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}
