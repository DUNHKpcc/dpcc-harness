import type { ACPConfigSelectOption } from "@shared/types/acp";
import {
  areAcpConfigOptionsEqual,
  replaceCachedAcpModelCatalog,
} from "@shared/lib/acp-config-cache";
import {
  BUILTIN_PI_AGENT_ID,
  type PiModelCacheRefreshResult,
} from "@shared/types/registry";
import { getAgent, updateCachedConfig } from "./agent-registry";
import { reportError } from "./error-utils";
import { log } from "./logger";
import { listPiUpstreamModels } from "./pi-acp-config";
import { resolvePiUpstream } from "./upstream-resolver";

function cachedModelName(
  value: string,
  providerNames: ReadonlyMap<string, string>,
): string {
  const separator = value.indexOf("/");
  if (separator <= 0) return value;
  const providerId = value.slice(0, separator);
  const providerName = providerNames.get(providerId);
  return providerName ? `${value} (${providerName})` : value;
}

export function buildPiCachedModelOptions(
  models: string[],
  providerNames: ReadonlyMap<string, string>,
): ACPConfigSelectOption[] {
  return models.map((value) => ({
    value,
    name: cachedModelName(value, providerNames),
    description: null,
  }));
}

async function performBuiltInPiModelCacheRefresh(): Promise<PiModelCacheRefreshResult> {
  try {
    const upstream = resolvePiUpstream();
    if (upstream.tier !== "default") {
      log("PI_MODEL_CACHE_REFRESH", { status: "skipped", reason: "source_not_default" });
      return { ok: false, error: "source_not_default", skipped: true };
    }

    const result = await listPiUpstreamModels(upstream);
    if (result.error || result.models.length === 0) {
      const error = result.error ?? "empty_catalog";
      log("PI_MODEL_CACHE_REFRESH", { status: "failed", error });
      return { ok: false, error };
    }

    const agent = getAgent(BUILTIN_PI_AGENT_ID);
    const current = agent?.cachedConfigOptions ?? [];
    const providerNames = new Map(upstream.providers.map((provider) => [
      provider.id,
      provider.name,
    ]));
    const next = replaceCachedAcpModelCatalog(
      current,
      buildPiCachedModelOptions(result.models, providerNames),
    );
    const updated = !areAcpConfigOptionsEqual(current, next);
    if (updated) updateCachedConfig(BUILTIN_PI_AGENT_ID, next);
    log("PI_MODEL_CACHE_REFRESH", {
      status: "ok",
      modelCount: result.models.length,
      updated,
    });
    return { ok: true, modelCount: result.models.length, updated };
  } catch (error) {
    return {
      ok: false,
      error: reportError("PI_MODEL_CACHE_REFRESH", error),
    };
  }
}

let refreshInFlight: Promise<PiModelCacheRefreshResult> | null = null;

/** 不创建Pi进程，刷新内置Pi模型缓存 */
export function refreshBuiltInPiModelCache(): Promise<PiModelCacheRefreshResult> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performBuiltInPiModelCacheRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
