import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { gitExec } from "./git-exec";
import { JsonFileStore } from "./json-file-store";
import type {
  InstalledSkillRecord,
  SkillInstallRequest,
  SkillTarget,
} from "../../../shared/types/plugins";

const MAX_SKILL_FILES = 1_000;
const MAX_SKILL_BYTES = 25 * 1024 * 1024;
const MAX_DISCOVERY_DEPTH = 5;
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const GITHUB_SOURCE_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const manifestStore = new JsonFileStore<InstalledSkillRecord[]>({
  subDir: "plugins/skills",
  label: "SKILL_INSTALL_MANIFEST",
});

function loadManifest(): InstalledSkillRecord[] {
  return manifestStore.load("manifest") ?? [];
}

function saveManifest(records: InstalledSkillRecord[]): void {
  manifestStore.save("manifest", records);
}

function recordId(request: SkillInstallRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      catalogId: request.catalogId,
      scope: request.scope,
      projectPath: request.projectPath ? path.resolve(request.projectPath) : null,
    }))
    .digest("hex");
}

export function normalizeSkillInstallRequest(request: SkillInstallRequest): SkillInstallRequest {
  const name = request.name.trim();
  const source = request.source.trim();
  if (request.scope !== "project" && request.scope !== "global") {
    throw new Error("Unsupported Skill installation scope");
  }
  if (!Array.isArray(request.targets)) throw new Error("Invalid Skill targets");
  const targets = Array.from(new Set(request.targets));
  if (!SKILL_NAME_PATTERN.test(name)) throw new Error("Invalid Skill name");
  if (!GITHUB_SOURCE_PATTERN.test(source)) {
    throw new Error("Only public GitHub Skill sources are supported in v0.1");
  }
  if (targets.length === 0) throw new Error("Select at least one Skill target");
  if (targets.some((target) => target !== "claude-code" && target !== "codex")) {
    throw new Error("Unsupported Skill target");
  }
  if (request.scope === "project" && !request.projectPath) {
    throw new Error("A project path is required for project Skills");
  }
  return {
    ...request,
    name,
    source,
    targets,
    projectPath: request.scope === "project" && request.projectPath
      ? path.resolve(request.projectPath)
      : undefined,
  };
}

function targetRoot(
  target: SkillTarget,
  scope: SkillInstallRequest["scope"],
  projectPath?: string,
): string {
  if (scope === "project") {
    if (!projectPath) throw new Error("A project path is required for project Skills");
    return path.join(projectPath, target === "claude-code" ? ".claude/skills" : ".agents/skills");
  }
  return path.join(os.homedir(), target === "claude-code" ? ".claude/skills" : ".agents/skills");
}

function assertInsideRoot(candidate: string, root: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (!relative) return;
    throw new Error("Skill path escapes its installation root");
  }
}

function frontmatterName(contents: string): string | null {
  const normalized = contents.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return null;
  const header = normalized.slice(4, end);
  const match = header.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m);
  return match?.[1]?.trim() ?? null;
}

export async function findSkillDirectory(repoPath: string, expectedName: string): Promise<string> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: repoPath, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const skillPath = path.join(current.dir, "SKILL.md");
    try {
      const stat = await fs.promises.lstat(skillPath);
      if (stat.isSymbolicLink()) throw new Error("Symbolic SKILL.md files are not supported");
      if (stat.isFile()) {
        const contents = await fs.promises.readFile(skillPath, "utf8");
        const declaredName = frontmatterName(contents);
        if (declaredName === expectedName) {
          return current.dir;
        }
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    if (current.depth >= MAX_DISCOVERY_DEPTH) continue;
    const entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  throw new Error(`Skill "${expectedName}" was not found in the source repository`);
}

interface SkillFile {
  absolutePath: string;
  relativePath: string;
  size: number;
}

export async function collectSkillFiles(skillDir: string): Promise<SkillFile[]> {
  const rootStat = await fs.promises.lstat(skillDir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Skill root must be a real directory");
  }
  const files: SkillFile[] = [];
  const queue = [skillDir];
  let totalBytes = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(skillDir, absolutePath);
      if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("Skill contains an invalid path");
      }
      if (entry.isSymbolicLink()) throw new Error("Skill symlinks are not supported");
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) throw new Error("Skill contains an unsupported file type");

      const stat = await fs.promises.stat(absolutePath);
      files.push({ absolutePath, relativePath, size: stat.size });
      totalBytes += stat.size;
      if (files.length > MAX_SKILL_FILES) throw new Error("Skill contains too many files");
      if (totalBytes > MAX_SKILL_BYTES) throw new Error("Skill exceeds the extracted size limit");
    }
  }

  if (!files.some((file) => file.relativePath === "SKILL.md")) {
    throw new Error("Skill is missing SKILL.md");
  }
  return files;
}

export async function hashSkillFiles(files: SkillFile[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(await fs.promises.readFile(file.absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export class SkillFilesModifiedError extends Error {
  constructor(destination: string) {
    super(`Managed Skill files were modified at ${destination}`);
    this.name = "SkillFilesModifiedError";
  }
}

async function copySkillAtomic(
  files: SkillFile[],
  destination: string,
  managedPaths: Set<string>,
): Promise<void> {
  const root = path.dirname(destination);
  assertInsideRoot(destination, root);
  await fs.promises.mkdir(root, { recursive: true });

  const destinationExists = await fs.promises.lstat(destination).then(() => true, () => false);
  if (destinationExists && !managedPaths.has(path.resolve(destination))) {
    throw new Error(`An unmanaged Skill already exists at ${destination}`);
  }

  const temporary = path.join(root, `.${path.basename(destination)}.tmp-${randomUUID()}`);
  const backup = path.join(root, `.${path.basename(destination)}.backup-${randomUUID()}`);
  await fs.promises.mkdir(temporary, { recursive: false });

  try {
    for (const file of files) {
      const target = path.join(temporary, file.relativePath);
      assertInsideRoot(target, temporary);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.copyFile(file.absolutePath, target);
    }

    if (destinationExists) await fs.promises.rename(destination, backup);
    await fs.promises.rename(temporary, destination);
    if (destinationExists) await fs.promises.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.promises.rm(temporary, { recursive: true, force: true });
    const backupExists = await fs.promises.lstat(backup).then(() => true, () => false);
    const currentExists = await fs.promises.lstat(destination).then(() => true, () => false);
    if (backupExists && !currentExists) await fs.promises.rename(backup, destination);
    throw error;
  }
}

export function listInstalledSkills(): InstalledSkillRecord[] {
  return loadManifest();
}

export async function installSkill(request: SkillInstallRequest): Promise<InstalledSkillRecord> {
  const normalized = normalizeSkillInstallRequest(request);
  const existingRecords = loadManifest();
  const id = recordId(normalized);
  const previous = existingRecords.find((record) => record.id === id);
  const currentManagedPaths = new Set(
    previous?.installPaths.map((item) => path.resolve(item)) ?? [],
  );
  const installedThisRun: string[] = [];

  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pcc-skill-"));
  const repositoryPath = path.join(temporaryRoot, "repository");
  try {
    const repositoryUrl = `https://github.com/${normalized.source}.git`;
    await gitExec(["clone", "--depth", "1", "--filter=blob:none", repositoryUrl, repositoryPath], temporaryRoot);
    const sourceRevision = (await gitExec(["rev-parse", "HEAD"], repositoryPath)).trim();
    const skillDirectory = await findSkillDirectory(repositoryPath, normalized.name);
    const files = await collectSkillFiles(skillDirectory);
    const contentHash = await hashSkillFiles(files);
    const installPaths = normalized.targets.map((target) => {
      const root = targetRoot(target, normalized.scope, normalized.projectPath);
      const destination = path.join(root, normalized.name);
      assertInsideRoot(destination, root);
      return destination;
    });

    if (previous?.contentHash && !normalized.allowOverwriteModified) {
      for (const destination of previous.installPaths) {
        const allowedRoot = previous.targets
          .map((target) => targetRoot(target, previous.scope, previous.projectPath))
          .find((root) => {
            const relative = path.relative(path.resolve(root), path.resolve(destination));
            return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
          });
        if (!allowedRoot) throw new Error("Installed Skill path is outside its managed root");
        const exists = await fs.promises.lstat(destination).then(() => true, () => false);
        if (!exists) continue;
        const installedFiles = await collectSkillFiles(destination);
        if (await hashSkillFiles(installedFiles) !== previous.contentHash) {
          throw new SkillFilesModifiedError(destination);
        }
      }
    }

    for (const destination of installPaths) {
      await copySkillAtomic(files, destination, currentManagedPaths);
      installedThisRun.push(destination);
    }

    for (const oldPath of previous?.installPaths ?? []) {
      if (!installPaths.includes(oldPath)) {
        await fs.promises.rm(oldPath, { recursive: true, force: true });
      }
    }

    const record: InstalledSkillRecord = {
      id,
      catalogId: normalized.catalogId,
      name: normalized.name,
      source: normalized.source,
      sourceRevision,
      contentHash,
      scope: normalized.scope,
      targets: normalized.targets,
      projectPath: normalized.projectPath,
      installPaths,
      installedAt: new Date().toISOString(),
    };
    saveManifest([...existingRecords.filter((item) => item.id !== id), record]);
    return record;
  } catch (error) {
    if (!previous) {
      for (const createdPath of installedThisRun) {
        await fs.promises.rm(createdPath, { recursive: true, force: true });
      }
    }
    throw error;
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function removeSkill(id: string): Promise<void> {
  const records = loadManifest();
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error("Installed Skill record not found");

  const allowedRoots = record.targets.map((target) =>
    targetRoot(target, record.scope, record.projectPath));
  for (const installPath of record.installPaths) {
    const matchingRoot = allowedRoots.find((root) => {
      const relative = path.relative(path.resolve(root), path.resolve(installPath));
      return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    if (!matchingRoot) throw new Error("Installed Skill path is outside its managed root");
    await fs.promises.rm(installPath, { recursive: true, force: true });
  }

  saveManifest(records.filter((item) => item.id !== id));
}
