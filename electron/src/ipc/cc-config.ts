import { ipcMain } from "electron";
import { reportError } from "../lib/error-utils";
import { resolveEffectiveCliConfig } from "../lib/effective-cli-config";
import { resolveClaudeUpstream, resolveCodexUpstream } from "../lib/upstream-resolver";
import { fetchUpstreamModels } from "../lib/upstream-models";
import type {
  EffectiveCliConfig,
  EffectiveEngineConfig,
  EffectiveCliModels,
  EffectiveModelList,
  EffectiveConfigSource,
} from "@shared/types/cc-config";

const EMPTY_ENGINE: EffectiveEngineConfig = {
  source: "default",
  providerName: null,
  baseUrl: null,
  maskedToken: null,
  model: null,
};

/** List the models available on one engine's effective upstream. */
async function listEngineModels(
  source: EffectiveConfigSource,
  baseUrl: string,
  token: string,
): Promise<EffectiveModelList> {
  if (source === "local" && !token) {
    return { source, models: [], error: "local_provider_unreadable" };
  }
  const { models, error } = await fetchUpstreamModels(baseUrl, token);
  return { source, models, error };
}

export function register(): void {
  ipcMain.handle("cc-config:effective", async (): Promise<EffectiveCliConfig> => {
    try {
      return resolveEffectiveCliConfig();
    } catch (err) {
      reportError("CC_CONFIG:EFFECTIVE_ERR", err);
      return { claude: { ...EMPTY_ENGINE }, codex: { ...EMPTY_ENGINE } };
    }
  });

  // All models PccAgent can pull from each engine's effective upstream (gateway,
  // local, or DPCC default) — drives the Current Config model list.
  ipcMain.handle("cc-config:models", async (): Promise<EffectiveCliModels> => {
    try {
      const claudeU = resolveClaudeUpstream();
      const codexU = resolveCodexUpstream();
      const [claude, codex] = await Promise.all([
        listEngineModels(claudeU.tier, claudeU.baseUrl, claudeU.token),
        listEngineModels(codexU.tier, codexU.baseUrl, codexU.apiKey),
      ]);
      return { claude, codex };
    } catch (err) {
      reportError("CC_CONFIG:MODELS_ERR", err);
      const empty: EffectiveModelList = { source: "default", models: [], error: "internal_error" };
      return { claude: { ...empty }, codex: { ...empty } };
    }
  });
}
