import { ipcMain } from "electron";
import { reportError } from "../lib/error-utils";
import { resolveEffectiveCliConfig } from "../lib/effective-cli-config";
import { resolvePiUpstream } from "../lib/upstream-resolver";
import { fetchUpstreamModels } from "../lib/upstream-models";
import { listPiUpstreamModels } from "../lib/pi-acp-config";
import type {
  EffectiveCliConfig,
  EffectiveEngineConfig,
  EffectiveCliModels,
  EffectiveModelList,
} from "@shared/types/cc-config";

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
      return { claude: { ...EMPTY_ENGINE }, codex: { ...EMPTY_ENGINE }, pi: { ...EMPTY_ENGINE } };
    }
  });

  // Only Pi is a live runtime. The empty legacy lists remain in the response
  // shape so older renderer builds can still read the IPC payload safely.
  ipcMain.handle("cc-config:models", async (): Promise<EffectiveCliModels> => {
    try {
      const piU = resolvePiUpstream();
      const piResult = await listPiUpstreamModels(piU);
      const pi: EffectiveModelList = {
        source: piU.tier,
        models: piResult.models,
        error: piResult.error,
      };
      const empty: EffectiveModelList = { source: "default", models: [], error: null };
      return { claude: { ...empty }, codex: { ...empty }, pi };
    } catch (err) {
      reportError("CC_CONFIG:MODELS_ERR", err);
      const empty: EffectiveModelList = { source: "default", models: [], error: "internal_error" };
      return { claude: { ...empty }, codex: { ...empty }, pi: { ...empty } };
    }
  });

  ipcMain.handle("cc-config:probe-models", async (_event, input: { baseUrl?: string; token?: string }): Promise<{ models: string[]; error: string | null }> => {
    try {
      return fetchUpstreamModels((input.baseUrl ?? "").trim(), (input.token ?? "").trim());
    } catch (err) {
      return { models: [], error: reportError("CC_CONFIG:PROBE_MODELS_ERR", err) };
    }
  });
}
