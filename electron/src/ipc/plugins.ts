import { ipcMain } from "electron";
import { addMcpServer, loadMcpServers } from "../lib/mcp-store";
import { discoverLocalMcpServers } from "../lib/local-mcp-discovery";
import {
  resolveMcpCatalogInstall,
  searchMcpCatalog,
  searchSkillCatalog,
} from "../lib/plugin-catalog";
import {
  installSkill,
  listInstalledSkills,
  removeSkill,
  SkillFilesModifiedError,
} from "../lib/skill-installer";
import { reportError } from "../lib/error-utils";
import type {
  McpCatalogInstallRequest,
  SkillInstallRequest,
} from "../../../shared/types/plugins";

export function register(): void {
  ipcMain.handle("plugins:skills:search", async (_event, query: string) => {
    try {
      return await searchSkillCatalog(typeof query === "string" ? query : "");
    } catch (error) {
      return { error: reportError("PLUGIN_SKILL_SEARCH_ERR", error) };
    }
  });

  ipcMain.handle("plugins:skills:list-installed", async () => {
    try {
      return { items: await listInstalledSkills() };
    } catch (error) {
      return { error: reportError("PLUGIN_SKILL_LIST_ERR", error) };
    }
  });

  ipcMain.handle("plugins:skills:install", async (_event, request: SkillInstallRequest) => {
    try {
      return { item: await installSkill(request) };
    } catch (error) {
      if (error instanceof SkillFilesModifiedError) {
        return { error: error.message, requiresConfirmation: true };
      }
      return { error: reportError("PLUGIN_SKILL_INSTALL_ERR", error) };
    }
  });

  ipcMain.handle("plugins:skills:remove", async (_event, id: string) => {
    try {
      await removeSkill(id);
      return { ok: true };
    } catch (error) {
      return { error: reportError("PLUGIN_SKILL_REMOVE_ERR", error) };
    }
  });

  ipcMain.handle("plugins:mcp:list", async (_event, query: string) => {
    try {
      return await searchMcpCatalog(typeof query === "string" ? query : "");
    } catch (error) {
      return { error: reportError("PLUGIN_MCP_LIST_ERR", error) };
    }
  });

  ipcMain.handle("plugins:mcp:list-installed", () => {
    try {
      return { items: discoverLocalMcpServers(loadMcpServers()) };
    } catch (error) {
      return { error: reportError("PLUGIN_MCP_INSTALLED_LIST_ERR", error) };
    }
  });

  ipcMain.handle("plugins:mcp:install", (_event, request: McpCatalogInstallRequest) => {
    try {
      const result = resolveMcpCatalogInstall(request);
      if (!result.ok || !result.server) return result;
      addMcpServer(result.server);
      return result;
    } catch (error) {
      return { ok: false, error: reportError("PLUGIN_MCP_INSTALL_ERR", error) };
    }
  });
}
