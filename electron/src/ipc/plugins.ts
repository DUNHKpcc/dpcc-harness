import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { addMcpServer } from "../lib/mcp-store";
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
import { readProjects } from "../lib/projects-store";
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

  ipcMain.handle("plugins:skills:list-installed", (_event, projectPath?: string | null) => {
    try {
      let validatedProjectPath: string | null = null;
      if (projectPath != null) {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          return { error: "Select a registered project before listing installed Skills" };
        }
        const requestedPath = path.resolve(projectPath);
        const project = readProjects().find((candidate) => path.resolve(candidate.path) === requestedPath);
        if (!project) {
          return { error: "Select a registered project before listing installed Skills" };
        }
        validatedProjectPath = project.path;
      }
      return { items: listInstalledSkills(validatedProjectPath) };
    } catch (error) {
      return { error: reportError("PLUGIN_SKILL_LIST_ERR", error) };
    }
  });

  ipcMain.handle("plugins:skills:install", async (_event, request: SkillInstallRequest) => {
    try {
      let validatedRequest = request;
      if (request.scope === "project") {
        const requestedPath = request.projectPath ? path.resolve(request.projectPath) : "";
        const project = readProjects().find((candidate) => path.resolve(candidate.path) === requestedPath);
        if (!project) return { error: "Select a registered project before installing this Skill" };
        const projectStat = fs.statSync(project.path, { throwIfNoEntry: false });
        if (!projectStat?.isDirectory()) return { error: "The selected project directory is unavailable" };
        validatedRequest = { ...request, projectPath: project.path };
      }
      return { item: await installSkill(validatedRequest) };
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

  ipcMain.handle("plugins:mcp:install", (_event, request: McpCatalogInstallRequest) => {
    try {
      if (!request.projectId?.trim()) return { ok: false, error: "A project is required" };
      if (!readProjects().some((project) => project.id === request.projectId)) {
        return { ok: false, error: "Select a registered project before installing this MCP server" };
      }
      const result = resolveMcpCatalogInstall(request);
      if (!result.ok || !result.server) return result;
      addMcpServer(request.projectId, result.server);
      return result;
    } catch (error) {
      return { ok: false, error: reportError("PLUGIN_MCP_INSTALL_ERR", error) };
    }
  });
}
