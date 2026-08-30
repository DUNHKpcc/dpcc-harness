import type { AppSettings, CliConfigSource } from "@shared/types/settings";

export type ConfigSourceEngine = "pi";

export function shouldApplyConfigSourceRefresh(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function buildConfigSourcePatch(
  engine: ConfigSourceEngine,
  source: CliConfigSource,
):
  | Pick<AppSettings, "piCliConfigSource"> {
  switch (engine) {
    case "pi":
      return { piCliConfigSource: source };
  }
}
