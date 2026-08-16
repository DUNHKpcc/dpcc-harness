import type { AppSettings, CliConfigSource } from "@shared/types/settings";

export type ConfigSourceEngine = "claude" | "codex" | "pi";

export function shouldApplyConfigSourceRefresh(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function buildConfigSourcePatch(
  engine: ConfigSourceEngine,
  source: CliConfigSource,
):
  | Pick<AppSettings, "claudeCliConfigSource">
  | Pick<AppSettings, "codexCliConfigSource">
  | Pick<AppSettings, "piCliConfigSource"> {
  switch (engine) {
    case "claude":
      return { claudeCliConfigSource: source };
    case "codex":
      return { codexCliConfigSource: source };
    case "pi":
      return { piCliConfigSource: source };
  }
}
