/**
 * Lists model ids from an OpenAI-compatible `/v1/models` endpoint. Shared by the
 * account panel (DPCC account models) and the Current Config panel (per-engine
 * effective-upstream models).
 */

import { extractErrorMessage } from "./error-utils";
import type { CodexModelCapability } from "@shared/types/codex";
import type { ReasoningEffort } from "@shared/types/codex-protocol/ReasoningEffort";

const REQUEST_TIMEOUT_MS = 8_000;
const REASONING_EFFORTS = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh"]);

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.has(value as ReasoningEffort);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize to a host root with no trailing slash or `/v1` suffix. */
export function normalizeModelsRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** GET {root}/v1/models with a bearer token. Returns ids + an error string on failure. */
export async function fetchUpstreamModels(
  baseUrl: string,
  token: string,
): Promise<{
  models: string[];
  capabilities?: Record<string, CodexModelCapability>;
  error: string | null;
}> {
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
    const body: unknown = await res.json();
    if (!isRecord(body) || !Array.isArray(body.data)) return { models: [], error: "invalid_response" };
    const upstreamModels = body.data.filter(isRecord);
    const models = upstreamModels
      .map((model) => (typeof model.id === "string" ? model.id : ""))
      .filter(Boolean);
    const capabilities = Object.fromEntries(
      upstreamModels.flatMap((model) => {
        if (typeof model.id !== "string") return [];
        const supportedReasoningEfforts = Array.isArray(model.supported_reasoning_efforts)
          ? model.supported_reasoning_efforts.filter(isReasoningEffort)
          : [];
        if (supportedReasoningEfforts.length === 0) return [];

        const capability: CodexModelCapability = { supportedReasoningEfforts };
        if (isReasoningEffort(model.default_reasoning_effort)
          && supportedReasoningEfforts.includes(model.default_reasoning_effort)) {
          capability.defaultReasoningEffort = model.default_reasoning_effort;
        }
        return [[model.id, capability]];
      }),
    );
    return Object.keys(capabilities).length > 0
      ? { models, capabilities, error: null }
      : { models, error: null };
  } catch (e) {
    return { models: [], error: extractErrorMessage(e) };
  } finally {
    clearTimeout(timeout);
  }
}
