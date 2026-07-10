import crypto from "crypto";
import type { CachedModelInfo } from "./claude-model-cache";
import { resolveClaudeUpstream } from "./upstream-resolver";
import { fetchUpstreamModels } from "./upstream-models";

const MODEL_CACHE_TTL_MS = 60_000;

interface ModelIdCache {
  expiresAt: number;
  modelIds: string[];
}

interface ClaudeModelSignature {
  family: "opus" | "sonnet" | "haiku";
  context: "base" | "1m";
}

const caches = new Map<string, ModelIdCache>();
const inFlight = new Map<string, Promise<string[] | null>>();
let cacheGeneration = 0;

function upstreamCacheKey(baseUrl: string, token: string): string {
  return crypto.createHash("sha256").update(`${baseUrl}\0${token}`).digest("hex");
}

async function loadDpccModelIds(baseUrl: string, token: string): Promise<string[] | null> {
  const key = upstreamCacheKey(baseUrl, token);
  const cached = caches.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.modelIds;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const staleModelIds = cached?.modelIds ?? null;
  const requestGeneration = cacheGeneration;
  const request = fetchUpstreamModels(baseUrl, token)
    .then(
      ({ models, error }) => {
        if (requestGeneration !== cacheGeneration) return null;
        if (error !== null) return staleModelIds;
        caches.set(key, {
          expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
          modelIds: models,
        });
        return models;
      },
      () => requestGeneration === cacheGeneration ? staleModelIds : null,
    )
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

function claudeModelSignature(value: string): ClaudeModelSignature | null {
  const normalized = value.trim().toLowerCase();
  const family = normalized.match(/(?:^|[-_])(opus|sonnet|haiku)(?:[-_]|$)/)?.[1];
  if (family !== "opus" && family !== "sonnet" && family !== "haiku") return null;

  return {
    family,
    context: /(?:^|[-_])1m(?:[-_]|$)/.test(normalized) ? "1m" : "base",
  };
}

function mergeClaudeModelsForUpstream(
  sdkModels: CachedModelInfo[],
  dpccModelIds: string[],
): CachedModelInfo[] {
  const exactMetadata = new Map<string, CachedModelInfo>();
  for (const model of sdkModels) {
    const value = model.value.trim();
    if (value && !exactMetadata.has(value)) exactMetadata.set(value, model);
  }

  const emittedIds = new Set<string>();
  const models: CachedModelInfo[] = [];
  for (const rawId of dpccModelIds) {
    const id = rawId.trim();
    if (!id || emittedIds.has(id)) continue;
    emittedIds.add(id);

    const exact = exactMetadata.get(id);
    if (exact) {
      models.push({ ...exact, value: id });
      continue;
    }

    const signature = claudeModelSignature(id);
    const alias = signature
      ? sdkModels.find((model) => {
        const candidate = claudeModelSignature(model.value);
        return candidate?.family === signature.family && candidate.context === signature.context;
      })
      : undefined;
    if (alias) {
      models.push({ ...alias, value: id });
      continue;
    }

    models.push({ value: id, displayName: id, description: "" });
  }

  return models;
}

export function clearClaudeModelCatalogCache(): void {
  cacheGeneration += 1;
  caches.clear();
  inFlight.clear();
}

/** Resolve the Claude picker catalog for the currently effective upstream. */
export async function resolveEffectiveClaudeModels(
  sdkModels: CachedModelInfo[],
): Promise<CachedModelInfo[]> {
  const upstream = resolveClaudeUpstream();
  if (upstream.tier !== "default") return sdkModels;

  const modelIds = await loadDpccModelIds(upstream.baseUrl, upstream.token);
  if (modelIds === null) return sdkModels;
  return mergeClaudeModelsForUpstream(sdkModels, modelIds);
}
