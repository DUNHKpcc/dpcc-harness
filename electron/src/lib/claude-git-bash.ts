import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import https from "https";
import { execFile } from "child_process";
import { promisify } from "util";
import portableGitAssets from "@shared/portable-git-assets.json";

export const CLAUDE_CODE_GIT_BASH_PATH = "CLAUDE_CODE_GIT_BASH_PATH";
export const CLAUDE_CODE_GIT_BASH_MISSING_MESSAGE =
  "Claude Code on Windows requires Git Bash. PccAgent can use system Git, bundled PortableGit, or managed PortableGit. If automatic setup fails, set CLAUDE_CODE_GIT_BASH_PATH to your bash.exe path, for example C:\\Program Files\\Git\\bin\\bash.exe.";

const PORTABLE_GIT_TARGET = "win32-x64";
const PORTABLE_GIT_ASSET = portableGitAssets[PORTABLE_GIT_TARGET];
const PORTABLE_GIT_FILE_NAME = PORTABLE_GIT_ASSET.fileName;
const PORTABLE_GIT_DOWNLOAD_URL = PORTABLE_GIT_ASSET.url;
const PORTABLE_GIT_SHA256 = PORTABLE_GIT_ASSET.sha256;
const PORTABLE_GIT_SIZE = PORTABLE_GIT_ASSET.size;
let portableGitSetupInFlight: Promise<void> | null = null;

type EnvLike = Record<string, string | undefined>;
type ExistsSync = (path: string) => boolean;

interface PortableGitPaths {
  managedRoot: string;
  managedBashPath: string;
  bundledArchivePath?: string;
}

export interface ClaudeCodeGitBashResolveOptions {
  userDataPath?: string;
  resourcesPath?: string;
}

export interface PrepareClaudeCodeGitBashOptions extends ClaudeCodeGitBashResolveOptions {
  platform?: NodeJS.Platform;
  existsSync?: ExistsSync;
  allowDownload?: boolean;
  extractPortableGitArchive?: (archivePath: string, destinationDir: string) => Promise<void>;
  downloadPortableGitArchive?: (destinationFile: string) => Promise<void>;
}

export interface ClaudeCodeGitBashStatus {
  required: boolean;
  ready: boolean;
  path: string | null;
  message: string | null;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function candidateExists(candidate: string, existsSync: (path: string) => boolean): boolean {
  try {
    return existsSync(candidate);
  } catch {
    return false;
  }
}

function portableGitPaths(options: ClaudeCodeGitBashResolveOptions): PortableGitPaths | null {
  if (!hasValue(options.userDataPath)) return null;
  const winPath = path.win32;
  const managedRoot = winPath.join(
    options.userDataPath,
    "pcc-agent-data",
    "git",
    "portable-git",
    PORTABLE_GIT_TARGET,
  );
  const bundledArchivePath = hasValue(options.resourcesPath)
    ? winPath.join(options.resourcesPath, "portable-git", PORTABLE_GIT_TARGET, PORTABLE_GIT_FILE_NAME)
    : undefined;
  return {
    managedRoot,
    managedBashPath: winPath.join(managedRoot, "bin", "bash.exe"),
    bundledArchivePath,
  };
}

function managedPortableGitBashPath(
  options: ClaudeCodeGitBashResolveOptions,
  existsSync: ExistsSync,
): string | undefined {
  const paths = portableGitPaths(options);
  if (!paths) return undefined;
  return candidateExists(paths.managedBashPath, existsSync) ? paths.managedBashPath : undefined;
}

export function resolveClaudeCodeGitBashPath(
  env: EnvLike = process.env,
  platform: NodeJS.Platform = process.platform,
  existsSync: (path: string) => boolean = fs.existsSync,
  options: ClaudeCodeGitBashResolveOptions = {},
): string | undefined {
  if (platform !== "win32") return undefined;
  if (hasValue(env[CLAUDE_CODE_GIT_BASH_PATH])) return env[CLAUDE_CODE_GIT_BASH_PATH];

  const winPath = path.win32;
  const candidates: string[] = [];

  for (const dir of [
    env.ProgramFiles,
    env.ProgramW6432,
    env["ProgramFiles(x86)"],
    env.LOCALAPPDATA ? winPath.join(env.LOCALAPPDATA, "Programs") : undefined,
  ]) {
    if (!hasValue(dir)) continue;
    candidates.push(winPath.join(dir, "Git", "bin", "bash.exe"));
    candidates.push(winPath.join(dir, "Git", "usr", "bin", "bash.exe"));
  }

  for (const entry of (env.Path ?? env.PATH ?? "").split(";")) {
    const dir = entry.trim();
    if (!dir) continue;
    candidates.push(winPath.join(dir, "bash.exe"));
    if (winPath.basename(dir).toLowerCase() === "cmd") {
      const gitRoot = winPath.dirname(dir);
      candidates.push(winPath.join(gitRoot, "bin", "bash.exe"));
      candidates.push(winPath.join(gitRoot, "usr", "bin", "bash.exe"));
    }
    if (winPath.basename(dir).toLowerCase() === "bin" && winPath.basename(winPath.dirname(dir)).toLowerCase() === "usr") {
      candidates.push(winPath.join(winPath.dirname(winPath.dirname(dir)), "bin", "bash.exe"));
    }
  }

  const systemGit = candidates.find((candidate) => candidateExists(candidate, existsSync));
  if (systemGit) return systemGit;

  return managedPortableGitBashPath(options, existsSync);
}

export function withClaudeCodeGitBashEnv<T extends EnvLike>(
  env: T,
  platform: NodeJS.Platform = process.platform,
  existsSync: (path: string) => boolean = fs.existsSync,
  options: ClaudeCodeGitBashResolveOptions = {},
): T {
  if (hasValue(env[CLAUDE_CODE_GIT_BASH_PATH])) return env;
  const gitBashPath = resolveClaudeCodeGitBashPath(env, platform, existsSync, options);
  if (!gitBashPath) return env;
  return {
    ...env,
    [CLAUDE_CODE_GIT_BASH_PATH]: gitBashPath,
  };
}

export function ensureClaudeCodeGitBashEnv<T extends EnvLike>(
  env: T,
  platform: NodeJS.Platform = process.platform,
  existsSync: (path: string) => boolean = fs.existsSync,
  options: ClaudeCodeGitBashResolveOptions = {},
): T {
  if (platform !== "win32") return env;
  const next = withClaudeCodeGitBashEnv(env, platform, existsSync, options);
  if (hasValue(next[CLAUDE_CODE_GIT_BASH_PATH])) return next;
  throw new Error(CLAUDE_CODE_GIT_BASH_MISSING_MESSAGE);
}

export async function prepareClaudeCodeGitBashEnv<T extends EnvLike>(
  env: T,
  options: PrepareClaudeCodeGitBashOptions = {},
): Promise<T> {
  const platform = options.platform ?? process.platform;
  const existsSync = options.existsSync ?? fs.existsSync;
  if (platform !== "win32") return env;

  const discovered = withClaudeCodeGitBashEnv(env, platform, existsSync, options);
  if (hasValue(discovered[CLAUDE_CODE_GIT_BASH_PATH])) return discovered;

  const paths = portableGitPaths(options);
  if (!paths) throw new Error(CLAUDE_CODE_GIT_BASH_MISSING_MESSAGE);

  const extractArchive = options.extractPortableGitArchive ?? extractPortableGitArchiveDefault;
  if (hasValue(paths.bundledArchivePath) && candidateExists(paths.bundledArchivePath, existsSync)) {
    await runPortableGitSetup(() => extractArchive(paths.bundledArchivePath as string, paths.managedRoot));
    const prepared = withClaudeCodeGitBashEnv(env, platform, existsSync, options);
    if (hasValue(prepared[CLAUDE_CODE_GIT_BASH_PATH])) return prepared;
  }

  if (options.allowDownload !== false) {
    await runPortableGitSetup(() => downloadAndExtractPortableGit(paths, options.downloadPortableGitArchive, extractArchive));
    const prepared = withClaudeCodeGitBashEnv(env, platform, existsSync, options);
    if (hasValue(prepared[CLAUDE_CODE_GIT_BASH_PATH])) return prepared;
  }

  throw new Error(CLAUDE_CODE_GIT_BASH_MISSING_MESSAGE);
}

export function getClaudeCodeGitBashStatus(
  env: EnvLike = process.env,
  platform: NodeJS.Platform = process.platform,
  existsSync: (path: string) => boolean = fs.existsSync,
  options: ClaudeCodeGitBashResolveOptions = {},
): ClaudeCodeGitBashStatus {
  if (platform !== "win32") {
    return { required: false, ready: true, path: null, message: null };
  }

  const gitBashPath = resolveClaudeCodeGitBashPath(env, platform, existsSync, options);
  const paths = portableGitPaths(options);
  const bundledArchiveReady = !!paths?.bundledArchivePath && candidateExists(paths.bundledArchivePath, existsSync);
  return {
    required: true,
    ready: hasValue(gitBashPath) || bundledArchiveReady,
    path: gitBashPath ?? (bundledArchiveReady ? paths?.managedBashPath ?? null : null),
    message: hasValue(gitBashPath) || bundledArchiveReady ? null : CLAUDE_CODE_GIT_BASH_MISSING_MESSAGE,
  };
}

const execFileAsync = promisify(execFile);

async function runPortableGitSetup(setup: () => Promise<void>): Promise<void> {
  if (!portableGitSetupInFlight) {
    portableGitSetupInFlight = setup().finally(() => {
      portableGitSetupInFlight = null;
    });
  }
  return portableGitSetupInFlight;
}

async function extractPortableGitArchiveDefault(archivePath: string, destinationDir: string): Promise<void> {
  const parentDir = path.dirname(destinationDir);
  const tmpDestination = `${destinationDir}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(tmpDestination, { recursive: true, force: true });
  fs.mkdirSync(parentDir, { recursive: true });

  try {
    await execFileAsync(archivePath, ["-y", `-o${tmpDestination}`], {
      windowsHide: true,
      timeout: 300_000,
    });
    if (!fs.existsSync(path.win32.join(tmpDestination, "bin", "bash.exe"))) {
      throw new Error("PortableGit extraction did not produce bin\\bash.exe");
    }
    fs.rmSync(destinationDir, { recursive: true, force: true });
    fs.renameSync(tmpDestination, destinationDir);
  } finally {
    fs.rmSync(tmpDestination, { recursive: true, force: true });
  }
}

async function downloadAndExtractPortableGit(
  paths: PortableGitPaths,
  downloadArchive: ((destinationFile: string) => Promise<void>) | undefined,
  extractArchive: (archivePath: string, destinationDir: string) => Promise<void>,
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portable-git-download-"));
  const archivePath = path.join(tmpDir, PORTABLE_GIT_FILE_NAME);
  try {
    await (downloadArchive ?? downloadPortableGitArchiveDefault)(archivePath);
    await extractArchive(archivePath, paths.managedRoot);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function downloadPortableGitArchiveDefault(destinationFile: string): Promise<void> {
  const tmpFile = `${destinationFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    await downloadFile(PORTABLE_GIT_DOWNLOAD_URL, tmpFile);
    const stat = fs.statSync(tmpFile);
    if (stat.size !== PORTABLE_GIT_SIZE) {
      throw new Error(`PortableGit download size mismatch: expected ${PORTABLE_GIT_SIZE}, got ${stat.size}`);
    }
    const digest = hashFile(tmpFile);
    if (digest !== PORTABLE_GIT_SHA256) {
      throw new Error("PortableGit download checksum mismatch");
    }
    fs.renameSync(tmpFile, destinationFile);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

function downloadFile(url: string, destinationFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "PccAgent" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destinationFile).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`PortableGit download failed with HTTP ${response.statusCode ?? "unknown"}`));
        return;
      }
      const out = fs.createWriteStream(destinationFile, { flags: "w" });
      out.on("error", reject);
      out.on("finish", () => out.close((err) => (err ? reject(err) : resolve())));
      response.on("error", reject);
      response.pipe(out);
    });
    request.on("error", reject);
  });
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export const __test = {
  portableGitPaths,
  PORTABLE_GIT_FILE_NAME,
  PORTABLE_GIT_DOWNLOAD_URL,
  PORTABLE_GIT_SHA256,
  PORTABLE_GIT_SIZE,
};
