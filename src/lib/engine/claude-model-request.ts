import { isActiveThirdPartyGateway } from "@shared/lib/upstream-routing";
import type { AppSettings, CliConfigSource } from "@shared/types/settings";

export interface ClaudeModelRequestIdentity {
  sessionId: string | null;
  generation: number;
}

export function isClaudeModelRequestCurrent(
  captured: ClaudeModelRequestIdentity,
  current: ClaudeModelRequestIdentity,
): boolean {
  return captured.sessionId === current.sessionId
    && captured.generation === current.generation;
}

export function isClaudeModelCacheRequestCurrent(
  capturedGeneration: number,
  currentGeneration: number,
): boolean {
  return capturedGeneration === currentGeneration;
}

export function isClaudeModelCatalogLoaded(
  models: readonly unknown[],
  authoritative: boolean | undefined,
): boolean {
  return models.length > 0 || authoritative === true;
}

function selectedClaudeSource(settings: AppSettings): CliConfigSource {
  return settings.claudeCliConfigSource ?? settings.cliConfigSource ?? "default";
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Only settings that can change the effective Claude model catalog. */
export function claudeModelCatalogSettingsFingerprint(settings: AppSettings): string {
  const selectedSource = selectedClaudeSource(settings);
  const binary = [settings.claudeBinarySource, settings.claudeCustomBinaryPath.trim()];
  const gatewayIsActive = selectedSource === "gateway" && isActiveThirdPartyGateway({
    enabled: settings.claudeGateway.enabled,
    baseUrl: settings.claudeGateway.baseUrl,
    credential: settings.claudeGateway.authToken,
  });

  if (selectedSource === "local") {
    return JSON.stringify([selectedSource, ...binary]);
  }
  if (gatewayIsActive) {
    return JSON.stringify([
      "gateway",
      ...binary,
      normalizedBaseUrl(settings.claudeGateway.baseUrl),
      settings.claudeGateway.authToken.trim(),
      settings.claudeGateway.model.trim(),
    ]);
  }

  return JSON.stringify([
    "default",
    ...binary,
    normalizedBaseUrl(settings.dpccUpstream.baseUrl),
    settings.dpccUpstream.claudeToken.trim(),
    settings.dpccUpstream.claudeModel.trim(),
  ]);
}
