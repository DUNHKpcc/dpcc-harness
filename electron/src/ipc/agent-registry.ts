import { ipcMain } from "electron";
import {
  listAgents,
  saveAgent,
  deleteAgent,
  loadUserAgents,
  updateCachedConfig,
  updateCachedSlashCommands,
  checkBinaries,
  getRegistryPlatformKeys,
} from "../lib/agent-registry";
import type { InstalledAgent } from "../lib/agent-registry";
import type { ACPConfigOption } from "@shared/types/acp";
import type { SlashCommand } from "@shared/types/engine";
import { getPiRuntimeStatus } from "../lib/pi-runtime-status";
import { listPiDraftSlashCommands } from "../lib/pi-command-catalog";
import { refreshBuiltInPiModelCache } from "../lib/pi-model-cache";

export function register(): void {
  loadUserAgents();

  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:save", (_e, agent: InstalledAgent) => {
    saveAgent(agent);
    return { ok: true };
  });
  ipcMain.handle("agents:delete", (_e, id: string) => {
    deleteAgent(id);
    return { ok: true };
  });
  ipcMain.handle("agents:update-cached-config", (_e, agentId: string, configOptions: ACPConfigOption[]) => {
    updateCachedConfig(agentId, configOptions);
    return { ok: true };
  });
  ipcMain.handle("agents:update-cached-commands", (_e, agentId: string, commands: SlashCommand[]) => {
    updateCachedSlashCommands(agentId, commands);
    return { ok: true };
  });

  // Batch-check if binary-only agents are installed on the system PATH
  ipcMain.handle(
    "agents:check-binaries",
    (_e, agents: Array<{ id: string; binary: Record<string, { cmd: string; args?: string[] }> }>) =>
      checkBinaries(agents),
  );
  ipcMain.handle("agents:get-platform-keys", () => getRegistryPlatformKeys());
  ipcMain.handle("agents:get-pi-runtime-status", () => getPiRuntimeStatus());
  ipcMain.handle("agents:refresh-pi-model-cache", () => refreshBuiltInPiModelCache());
  ipcMain.handle("agents:list-pi-draft-commands", (_e, cwd: string) => ({
    commands: listPiDraftSlashCommands(cwd),
  }));
}
