import { ipcMain } from "electron";
import { reportError } from "../lib/error-utils";
import { resolveEffectiveCliConfig } from "../lib/effective-cli-config";
import type { EffectiveCliConfig, EffectiveEngineConfig } from "@shared/types/cc-config";

const EMPTY_ENGINE: EffectiveEngineConfig = {
  source: "default",
  providerName: null,
  baseUrl: null,
  maskedToken: null,
  model: null,
};

export function register(): void {
  ipcMain.handle("cc-config:effective", async (): Promise<EffectiveCliConfig> => {
    try {
      return resolveEffectiveCliConfig();
    } catch (err) {
      reportError("CC_CONFIG:EFFECTIVE_ERR", err);
      return { claude: { ...EMPTY_ENGINE }, codex: { ...EMPTY_ENGINE } };
    }
  });
}
