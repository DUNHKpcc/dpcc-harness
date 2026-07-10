import { useEffect, useRef } from "react";
import { isActiveThirdPartyGateway } from "@shared/lib/upstream-routing";
import type { AppSettings, CliConfigSource } from "@shared/types/settings";

type PrefetchCodexModels = (
  preferredModel?: string,
  isCurrent?: () => boolean,
) => Promise<boolean>;

interface UseCodexModelCatalogSyncParams {
  isCodex: boolean;
  rawModelCount: number;
  activeSessionId: string | null;
  preferredModel?: string;
  prefetchCodexModels: PrefetchCodexModels;
  clearModels: () => void;
}

function selectedCodexSource(settings: AppSettings): CliConfigSource {
  return settings.codexCliConfigSource ?? settings.cliConfigSource ?? "default";
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Only fields that can change the effective Codex model catalog. */
export function codexModelCatalogSettingsFingerprint(settings: AppSettings): string {
  const selectedSource = selectedCodexSource(settings);
  const binary = [settings.codexBinarySource, settings.codexCustomBinaryPath.trim()];
  const gatewayIsActive = selectedSource === "gateway" && isActiveThirdPartyGateway({
    enabled: settings.codexGateway.enabled,
    baseUrl: settings.codexGateway.baseUrl,
    credential: settings.codexGateway.apiKey,
  });

  if (selectedSource === "local") {
    return JSON.stringify([selectedSource, ...binary]);
  }
  if (gatewayIsActive) {
    return JSON.stringify([
      "gateway",
      ...binary,
      normalizedBaseUrl(settings.codexGateway.baseUrl),
      settings.codexGateway.apiKey.trim(),
      settings.codexGateway.model.trim(),
    ]);
  }

  return JSON.stringify([
    "default",
    ...binary,
    normalizedBaseUrl(settings.dpccUpstream.baseUrl),
    settings.dpccUpstream.codexToken.trim(),
    settings.dpccUpstream.codexModel.trim(),
  ]);
}

export function useCodexModelCatalogSync({
  isCodex,
  rawModelCount,
  activeSessionId,
  preferredModel,
  prefetchCodexModels,
  clearModels,
}: UseCodexModelCatalogSyncParams): void {
  const prefetchKeyRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const settingsFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isCodex) {
      prefetchKeyRef.current = null;
      requestGenerationRef.current += 1;
      return;
    }
    if (rawModelCount > 0) return;

    const prefetchKey = `${activeSessionId ?? "none"}:${preferredModel ?? ""}`;
    if (prefetchKeyRef.current === prefetchKey) return;
    prefetchKeyRef.current = prefetchKey;
    const generation = ++requestGenerationRef.current;

    void prefetchCodexModels(
      preferredModel,
      () => requestGenerationRef.current === generation,
    ).then((loaded) => {
      if (!loaded && requestGenerationRef.current === generation) {
        prefetchKeyRef.current = null;
      }
    });

    return () => {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
      }
    };
  }, [activeSessionId, isCodex, preferredModel, prefetchCodexModels, rawModelCount]);

  useEffect(() => {
    let disposed = false;
    void window.claude.settings.get().then((settings) => {
      if (!disposed && settingsFingerprintRef.current === null) {
        settingsFingerprintRef.current = codexModelCatalogSettingsFingerprint(settings);
      }
    });

    const unsubscribe = window.claude.settings.onChanged((settings) => {
      const nextFingerprint = codexModelCatalogSettingsFingerprint(settings);
      const previousFingerprint = settingsFingerprintRef.current;
      settingsFingerprintRef.current = nextFingerprint;
      if (previousFingerprint === null || previousFingerprint === nextFingerprint) return;

      requestGenerationRef.current += 1;
      prefetchKeyRef.current = null;
      clearModels();
    });

    return () => {
      disposed = true;
      requestGenerationRef.current += 1;
      unsubscribe();
    };
  }, [clearModels]);
}
