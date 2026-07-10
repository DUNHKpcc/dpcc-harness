import crypto from "crypto";
import type { CachedModelInfo } from "./claude-model-cache";
import type { ClaudeUpstream } from "./upstream-resolver";
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
  version: string | null;
}

const caches = new Map<string, ModelIdCache>();
const inFlight = new Map<string, Promise<string[] | null>>();
let cacheGeneration = 0;

function upstreamCacheKey(baseUrl: string, token: string): string {
  return crypto.createHash("sha256").update(`${baseUrl}\0${token}`).digest("hex");
}

/** Opaque identity for associating SDK metadata with its effective upstream. */
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

function claudeModelSignature(...values: string[]): ClaudeModelSignature | null {
  const metadata = values.join(" ").trim().toLowerCase();
  const family = metadata.match(/(?:^|[^a-z])(opus|sonnet|haiku)(?:[^a-z]|$)/)?.[1];
  if (family !== "opus" && family !== "sonnet" && family !== "haiku") return null;
  const version = metadata.match(/(?:^|[^0-9])([1-9])[.-]([0-9])(?=[^0-9]|$)/);

  return {
    family,
    context: /(?:^|[^a-z0-9])1m(?:[^a-z0-9]|$)/.test(metadata) ? "1m" : "base",
    version: version ? `${version[1]}.${version[2]}` : null,
  };
}

function findClaudeAlias(
  sdkModels: CachedModelInfo[],
  target: ClaudeModelSignature,
): CachedModelInfo | undefined {
  const candidates = sdkModels.flatMap((model) => {
    if (model.value.trim() === "default") return [];
    const signature = claudeModelSignature(model.value, model.displayName, model.description);
    if (signature?.family !== target.family || signature.context !== target.context) return [];
    return [{ model, signature }];
  });

  if (!target.version) return candidates[0]?.model;
  return candidates.find(({ signature }) => signature.version === target.version)?.model
    ?? candidates.find(({ signature }) => signature.version === null)?.model;
}

function isSameClaudeUpstream(left: ClaudeUpstream, right: ClaudeUpstream): boolean {
  return claudeUpstreamFingerprint(left) === claudeUpstreamFingerprint(right);
}

function mergeClaudeModelsForUpstream(
  sdkModels: CachedModelInfo[],
  dpccModelIds: string[],
  preferredModel: string,
): CachedModelInfo[] {
  const exactMetadata = new Map<string, CachedModelInfo>();
  for (const model of sdkModels) {
    const value = model.value.trim();
    if (value && !exactMetadata.has(value)) exactMetadata.set(value, model);
  }

  const preferredModelId = preferredModel.trim();
  const defaultMetadata = preferredModelId ? exactMetadata.get("default") : undefined;
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

    if (defaultMetadata && id === preferredModelId) {
      models.push({ ...defaultMetadata, value: id });
      continue;
    }

    const signature = claudeModelSignature(id);
    const alias = signature ? findClaudeAlias(sdkModels, signature) : undefined;
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
  expectedUpstreamFingerprint?: string,
): Promise<CachedModelInfo[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const upstream = resolveClaudeUpstream();
    if (expectedUpstreamFingerprint
      && claudeUpstreamFingerprint(upstream) !== expectedUpstreamFingerprint) {
      return [];
    }
    if (upstream.tier !== "default") return sdkModels;

    const modelIds = await loadDpccModelIds(upstream.baseUrl, upstream.token);
    const currentUpstream = resolveClaudeUpstream();
    if (expectedUpstreamFingerprint
      && claudeUpstreamFingerprint(currentUpstream) !== expectedUpstreamFingerprint) {
      return [];
    }
    if (!isSameClaudeUpstream(upstream, currentUpstream)) continue;
    if (modelIds === null) return sdkModels;
    return mergeClaudeModelsForUpstream(sdkModels, modelIds, upstream.model);
  }

  return [];
}
