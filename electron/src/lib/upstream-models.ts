/**
 * Lists model ids from an OpenAI-compatible `/v1/models` endpoint. Shared by the
 * account panel (DPCC account models) and the Current Config panel (per-engine
 * effective-upstream models).
 */

import { extractErrorMessage } from "./error-utils";
import type { CodexModelCapability } from "@shared/types/codex";
import type { ReasoningEffort } from "@shared/types/codex-protocol/ReasoningEffort";

const REQUEST_TIMEOUT_MS = 8_000;
const reasoningEfforts = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh"]);

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && reasoningEfforts.has(value as ReasoningEffort);
}

type UpstreamModel = {
  id?: string;
  supported_reasoning_efforts?: unknown;
  default_reasoning_effort?: unknown;
};

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
    const body = (await res.json()) as { data?: UpstreamModel[] };
    if (!Array.isArray(body.data)) return { models: [], error: "invalid_response" };
    const models = body.data
      .map((m) => (typeof m?.id === "string" ? m.id : ""))
      .filter(Boolean);
    const capabilities = Object.fromEntries(
      body.data.flatMap((model) => {
        if (typeof model?.id !== "string") return [];
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
