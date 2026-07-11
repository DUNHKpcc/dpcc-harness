import crypto from "crypto";
import { mergeCodexModelsForUpstream } from "@shared/lib/codex-helpers";
import type { CodexModel } from "@shared/types/codex";
import { resolveCodexUpstream } from "./upstream-resolver";
import { fetchUpstreamModels } from "./upstream-models";

const MODEL_CACHE_TTL_MS = 60_000;

interface ModelIdCache {
  expiresAt: number;
  modelIds: string[];
}

const caches = new Map<string, ModelIdCache>();
const inFlight = new Map<string, Promise<string[] | null>>();
let cacheGeneration = 0;

function upstreamCacheKey(baseUrl: string, apiKey: string): string {
  return crypto.createHash("sha256").update(`${baseUrl}\0${apiKey}`).digest("hex");
}

async function loadDpccModelIds(baseUrl: string, apiKey: string): Promise<string[] | null> {
  const key = upstreamCacheKey(baseUrl, apiKey);
  const now = Date.now();
  const cached = caches.get(key);
  if (cached && cached.expiresAt > now) return cached.modelIds;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const staleModelIds = cached?.modelIds ?? null;
  const requestGeneration = cacheGeneration;

  const request = fetchUpstreamModels(baseUrl, apiKey)
    .then(({ models, error }) => {
      if (requestGeneration !== cacheGeneration) return null;
      if (error) return staleModelIds;
      caches.set(key, { expiresAt: Date.now() + MODEL_CACHE_TTL_MS, modelIds: models });
      return models;
    })
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

export function clearCodexModelCatalogCache(): void {
  cacheGeneration += 1;
  caches.clear();
  inFlight.clear();
}

/** Resolve the model catalog exposed to Codex sessions and the composer. */
export async function resolveEffectiveCodexModels(nativeModels: CodexModel[]): Promise<CodexModel[]> {
  const upstream = resolveCodexUpstream();
  if (upstream.tier !== "default") return nativeModels;

  const modelIds = await loadDpccModelIds(upstream.baseUrl, upstream.apiKey);
  if (!modelIds) return nativeModels;
  return mergeCodexModelsForUpstream(nativeModels, modelIds, upstream.model);
}
