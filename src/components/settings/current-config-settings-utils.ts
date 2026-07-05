import type { AppSettings, CliConfigSource } from "@shared/types/settings";

export type ConfigSourceEngine = "claude" | "codex";

export function shouldApplyConfigSourceRefresh(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function buildConfigSourcePatch(
  engine: ConfigSourceEngine,
  source: CliConfigSource,
): Pick<AppSettings, "claudeCliConfigSource"> | Pick<AppSettings, "codexCliConfigSource"> {
  return engine === "claude"
    ? { claudeCliConfigSource: source }
    : { codexCliConfigSource: source };
}
