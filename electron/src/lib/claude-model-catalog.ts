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

function findClaudeCapabilityMetadata(
  sdkModels: CachedModelInfo[],
  target: ClaudeModelSignature,
): CachedModelInfo | undefined {
  return sdkModels.find((model) => {
    const signature = claudeModelSignature(model.value);
    return signature?.family === target.family
      && signature.context === target.context
      && (signature.version === target.version || signature.version === null)
      && isCustomClaudeMetadata(model);
  });
}

function claudeCapabilityFields(model: CachedModelInfo | undefined): Partial<CachedModelInfo> {
  if (!model) return {};
  return {
    ...(model.supportsEffort === undefined ? {} : { supportsEffort: model.supportsEffort }),
    ...(model.supportedEffortLevels === undefined
      ? {}
      : { supportedEffortLevels: [...model.supportedEffortLevels] }),
    ...(model.supportsAdaptiveThinking === undefined
      ? {}
      : { supportsAdaptiveThinking: model.supportsAdaptiveThinking }),
  };
}

function isCustomClaudeMetadata(model: CachedModelInfo): boolean {
  if (/custom/i.test(model.description)) return true;
  const valueFamily = claudeModelSignature(model.value)?.family;
  if (!valueFamily) return false;
  return claudeModelSignature(model.displayName)?.family !== valueFamily;
}

function fallbackClaudeModel(
  id: string,
  capabilityMetadata?: CachedModelInfo,
): CachedModelInfo {
  return {
    value: id,
    displayName: id,
    description: "",
    ...claudeCapabilityFields(capabilityMetadata),
  };
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
      models.push(isCustomClaudeMetadata(exact)
        ? fallbackClaudeModel(id, exact)
        : { ...exact, value: id });
      continue;
    }

    const signature = claudeModelSignature(id);
    const capabilityMetadata = signature
      ? findClaudeCapabilityMetadata(sdkModels, signature)
      : undefined;

    if (defaultMetadata && id === preferredModelId) {
      models.push(isCustomClaudeMetadata(defaultMetadata)
        ? fallbackClaudeModel(id, defaultMetadata)
        : { ...defaultMetadata, value: id });
      continue;
    }

    const alias = signature ? findClaudeAlias(sdkModels, signature) : undefined;
    if (alias) {
      models.push(isCustomClaudeMetadata(alias)
        ? fallbackClaudeModel(id, alias)
        : { ...alias, value: id });
      continue;
    }

    models.push(fallbackClaudeModel(id, capabilityMetadata));
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
    if (modelIds === null) return { models: sdkModels, authoritative: false };
    return {
      models: mergeClaudeModelsForUpstream(sdkModels, modelIds, upstream.model),
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
