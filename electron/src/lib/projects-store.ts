import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getDataDir } from "./data-dir";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  spaceId?: string;
  icon?: string;
  iconType?: "emoji" | "lucide";
  /** Auto-created by the WeChat bridge; hidden from the normal project list. */
  wechat?: boolean;
}

function getProjectsFilePath(): string {
  return path.join(getDataDir(), "projects.json");
}

export function readProjects(): Project[] {
  const filePath = getProjectsFilePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

export function writeProjects(projects: Project[]): void {
  fs.writeFileSync(getProjectsFilePath(), JSON.stringify(projects, null, 2), "utf-8");
}

/**
 * Return the project whose `path` matches `dirPath`, creating one if absent.
 * Used by the WeChat bridge to bind its workDir to a single sidebar project
 * without requiring the user to pre-create it. An optional icon is applied on
 * creation (and healed onto an existing match that has no icon yet).
 */
export function ensureProjectForPath(
  dirPath: string,
  name?: string,
  opts?: { icon?: string; iconType?: "emoji" | "lucide"; wechat?: boolean },
): Project {
  const projects = readProjects();
  const existing = projects.find((p) => p.path === dirPath);
  if (existing) {
    let changed = false;
    if (opts?.icon && !existing.icon) {
      existing.icon = opts.icon;
      existing.iconType = opts.iconType;
      changed = true;
    }
    if (opts?.wechat && !existing.wechat) {
      existing.wechat = true;
      changed = true;
    }
    if (changed) writeProjects(projects);
    return existing;
  }

  const project: Project = {
    id: crypto.randomUUID(),
    name: name || path.basename(dirPath) || "WeChat",
    path: dirPath,
    createdAt: Date.now(),
    ...(opts?.icon ? { icon: opts.icon, iconType: opts.iconType } : {}),
    ...(opts?.wechat ? { wechat: true } : {}),
  };
  projects.push(project);
  writeProjects(projects);
  return project;
}

/**
 * Tag an existing project as the WeChat-bound one (and give it the phone icon if
 * it has none) so the sidebar hides the otherwise-empty duplicate card.
 */
export function markWechatProject(projectId: string, icon: string, iconType: "emoji" | "lucide"): void {
  const projects = readProjects();
  const p = projects.find((x) => x.id === projectId);
  if (!p) return;
  let changed = false;
  if (!p.wechat) {
    p.wechat = true;
    changed = true;
  }
  if (!p.icon) {
    p.icon = icon;
    p.iconType = iconType;
    changed = true;
  }
  if (changed) writeProjects(projects);
}
