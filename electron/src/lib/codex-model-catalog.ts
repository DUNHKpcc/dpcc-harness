import crypto from "crypto";
import { mergeCodexModelsForUpstream } from "@shared/lib/codex-helpers";
import type { CodexModel, CodexModelCapability } from "@shared/types/codex";
import { resolveCodexUpstream } from "./upstream-resolver";
import { fetchUpstreamModels } from "./upstream-models";

const MODEL_CACHE_TTL_MS = 60_000;

interface UpstreamCodexCatalog {
  modelIds: string[];
  capabilities: Record<string, CodexModelCapability>;
}

interface CachedUpstreamCodexCatalog extends UpstreamCodexCatalog {
  expiresAt: number;
}

const caches = new Map<string, CachedUpstreamCodexCatalog>();
const inFlight = new Map<string, Promise<UpstreamCodexCatalog | null>>();
let cacheGeneration = 0;

function upstreamCacheKey(baseUrl: string, apiKey: string): string {
  return crypto.createHash("sha256").update(`${baseUrl}\0${apiKey}`).digest("hex");
}

async function loadDpccModelCatalog(
  baseUrl: string,
  apiKey: string,
): Promise<UpstreamCodexCatalog | null> {
  const key = upstreamCacheKey(baseUrl, apiKey);
  const now = Date.now();
  const cachedEntry = caches.get(key);
  if (cachedEntry && cachedEntry.expiresAt > now) return cachedEntry;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const staleCatalog: UpstreamCodexCatalog | null = cachedEntry
    ? { modelIds: cachedEntry.modelIds, capabilities: cachedEntry.capabilities }
    : null;
  const requestGeneration = cacheGeneration;

  const request = fetchUpstreamModels(baseUrl, apiKey)
    .then(({ models, capabilities, error }) => {
      if (requestGeneration !== cacheGeneration) return null;
      if (error) return staleCatalog;
      const catalog: UpstreamCodexCatalog = { modelIds: models, capabilities: capabilities ?? {} };
      caches.set(key, { expiresAt: Date.now() + MODEL_CACHE_TTL_MS, ...catalog });
      return catalog;
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

  const catalog = await loadDpccModelCatalog(upstream.baseUrl, upstream.apiKey);
  if (!catalog) return nativeModels;
  return mergeCodexModelsForUpstream(
    nativeModels,
    catalog.modelIds,
    upstream.model,
    catalog.capabilities,
  );
}
