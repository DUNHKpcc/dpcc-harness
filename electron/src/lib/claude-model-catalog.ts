import crypto from "crypto";
import { getModelEffortProfile } from "@shared/lib/model-effort-capabilities";
import type { CachedModelInfo } from "./claude-model-cache";
import type { ClaudeUpstream } from "./upstream-resolver";
import { resolveClaudeUpstream } from "./upstream-resolver";
import { fetchUpstreamModels } from "./upstream-models";

const MODEL_CACHE_TTL_MS = 60_000;

interface ModelIdCache {
  expiresAt: number;
  modelIds: string[];
}

export interface EffectiveClaudeModelsResult {
  models: CachedModelInfo[];
  /** True only when the active DPCC `/v1/models` request succeeded. */
  authoritative: boolean;
  /** The upstream changed while this result was being resolved. */
  stale?: boolean;
}

const caches = new Map<string, ModelIdCache>();
const inFlight = new Map<string, Promise<string[] | null>>();
let cacheGeneration = 0;

function upstreamCacheKey(baseUrl: string, token: string): string {
  return crypto.createHash("sha256").update(`${baseUrl}\0${token}`).digest("hex");
}

/** Opaque identity for associating model data with its effective upstream. */
export function claudeUpstreamFingerprint(upstream: ClaudeUpstream): string {
  return crypto.createHash("sha256")
    .update(`${upstream.tier}\0${upstream.baseUrl}\0${upstream.token}\0${upstream.model}`)
    .digest("hex");
}

async function loadDpccModelIds(baseUrl: string, token: string): Promise<string[] | null> {
  const key = upstreamCacheKey(baseUrl, token);
  const cached = caches.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.modelIds;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const requestGeneration = cacheGeneration;
  const request = fetchUpstreamModels(baseUrl, token)
    .then(
      ({ models, error }) => {
        if (requestGeneration !== cacheGeneration) return null;
        if (error !== null) return null;
        caches.set(key, {
          expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
          modelIds: models,
        });
        return models;
      },
      () => null,
    )
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

function dpccClaudeModel(id: string): CachedModelInfo {
  const effort = getModelEffortProfile(id);
  return {
    value: id,
    displayName: id,
    description: "",
    ...(effort
      ? {
          supportsEffort: true,
          supportedEffortLevels: effort.levels.filter(
            (level): level is NonNullable<CachedModelInfo["supportedEffortLevels"]>[number] =>
              level !== "none" && level !== "minimal",
          ),
        }
      : {}),
  };
}

function isSameClaudeUpstream(left: ClaudeUpstream, right: ClaudeUpstream): boolean {
  return claudeUpstreamFingerprint(left) === claudeUpstreamFingerprint(right);
}

function buildDpccClaudeModels(dpccModelIds: string[]): CachedModelInfo[] {
  const emittedIds = new Set<string>();
  const models: CachedModelInfo[] = [];
  for (const rawId of dpccModelIds) {
    const id = rawId.trim();
    if (!id || emittedIds.has(id)) continue;
    emittedIds.add(id);
    models.push(dpccClaudeModel(id));
  }

  return models;
}

/** Resolve a request model without allowing a stale local picker value onto DPCC. */
export async function resolveClaudeModelForRequest(
  requestedModel?: string | null,
): Promise<string | undefined> {
  const requested = requestedModel?.trim();
  for (let attempt = 0; attempt < 2; attempt++) {
    const upstream = resolveClaudeUpstream();
    if (upstream.tier === "local") return requested || undefined;
    if (upstream.tier === "gateway") return upstream.model.trim() || requested || undefined;

    const fingerprint = claudeUpstreamFingerprint(upstream);
    const modelIds = await loadDpccModelIds(upstream.baseUrl, upstream.token);
    if (fingerprint !== claudeUpstreamFingerprint(resolveClaudeUpstream())) continue;
    if (modelIds === null) return upstream.model.trim() || undefined;
    const ids = modelIds.map((id) => id.trim()).filter(Boolean);
    const configured = upstream.model.trim();
    if (configured && ids.includes(configured)) return configured;
    if (requested && ids.includes(requested)) return requested;
    return ids[0];
  }
  return undefined;
}

export function clearClaudeModelCatalogCache(): void {
  cacheGeneration += 1;
  caches.clear();
  inFlight.clear();
}

/** Resolve the Claude picker catalog and whether it is authoritative for the current upstream. */
export async function resolveEffectiveClaudeModelsResult(
  sdkModels: CachedModelInfo[],
  expectedUpstreamFingerprint?: string,
): Promise<EffectiveClaudeModelsResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const upstream = resolveClaudeUpstream();
    if (expectedUpstreamFingerprint
      && claudeUpstreamFingerprint(upstream) !== expectedUpstreamFingerprint) {
      return { models: [], authoritative: false, stale: true };
    }
    if (upstream.tier !== "default") return { models: sdkModels, authoritative: false };

    const modelIds = await loadDpccModelIds(upstream.baseUrl, upstream.token);
    const currentUpstream = resolveClaudeUpstream();
    if (expectedUpstreamFingerprint
      && claudeUpstreamFingerprint(currentUpstream) !== expectedUpstreamFingerprint) {
      return { models: [], authoritative: false, stale: true };
    }
    if (!isSameClaudeUpstream(upstream, currentUpstream)) continue;
    if (modelIds === null) return { models: [], authoritative: false };
    return {
      models: buildDpccClaudeModels(modelIds),
      authoritative: true,
    };
  }

  return { models: [], authoritative: false, stale: true };
}

/** Resolve the Claude picker catalog for callers that only need the model list. */
export async function resolveEffectiveClaudeModels(
  sdkModels: CachedModelInfo[],
  expectedUpstreamFingerprint?: string,
): Promise<CachedModelInfo[]> {
  return (await resolveEffectiveClaudeModelsResult(sdkModels, expectedUpstreamFingerprint)).models;
}
