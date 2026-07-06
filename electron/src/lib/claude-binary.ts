import fs from "fs";
import os from "os";
import path from "path";
import { execFile, execFileSync, spawn } from "child_process";
import { promisify } from "util";
import { app as electronApp } from "electron";
import { getAppSetting } from "./app-settings";
import { getClaudeCodeGitBashStatus, type ClaudeCodeGitBashStatus } from "./claude-git-bash";
import { extractErrorMessage, reportError } from "./error-utils";
import { log } from "./logger";
import { getCliPath } from "./sdk";

export type ClaudeBinarySource = "builtin" | "auto" | "managed" | "custom";
export type ClaudeBinaryResolutionStrategy = "custom" | "env" | "known" | "path" | "sdk-fallback";

interface ResolveClaudeBinaryOptions {
  installIfMissing?: boolean;
  allowSdkFallback?: boolean;
}

interface ClaudeBinaryResolution {
  strategy: ClaudeBinaryResolutionStrategy;
  path: string;
}

let cachedPath: string | null = null;
let cachedSource: ClaudeBinarySource | null = null;
let installInFlight: Promise<string> | null = null;
const execFileAsync = promisify(execFile);

const CLAUDE_INSTALL_SH = "https://claude.ai/install.sh";
const CLAUDE_INSTALL_PS1 = "https://claude.ai/install.ps1";
const CLAUDE_INSTALL_CMD = "https://claude.ai/install.cmd";

function getSource(): ClaudeBinarySource {
  return getAppSetting("claudeBinarySource");
}

function getCustomPath(): string {
  return getAppSetting("claudeCustomBinaryPath")?.trim() || "";
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeExecutablePath(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  const normalized = path.normalize(trimmed);
  return isExecutable(normalized) ? normalized : null;
}

function getEnvOverride(): string | null {
  const envPath = process.env.CLAUDE_CODE_CLI_PATH || process.env.CLAUDE_CLI_PATH;
  return envPath ? normalizeExecutablePath(envPath) : null;
}

function getKnownPaths(): string[] {
  if (process.platform === "win32") return [];
  return [path.join(os.homedir(), ".local", "bin", "claude")];
}

function isScriptExecutable(filePath: string): boolean {
  return [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].includes(path.extname(filePath));
}

function getNodeRuntimeExecutable(): string | null {
  const candidates = [
    process.env.npm_node_execpath,
    process.env.NODE,
    ...nodeRuntimeCandidatesFromPath(),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeExecutablePath(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function nodeRuntimeCandidatesFromPath(): string[] {
  const envPath = process.env.PATH;
  if (!envPath) return [];
  return envPath
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, process.platform === "win32" ? "node.exe" : "node"));
}

function getElectronHelperNodeRuntimeExecutable(): string | null {
  const override = process.env.PCC_AGENT_ELECTRON_NODE_HELPER;
  if (override) {
    const normalized = normalizeExecutablePath(override);
    if (normalized) return normalized;
  }

  if (process.platform !== "darwin") return null;
  const appExecutableName = path.basename(process.execPath);
  const helperPath = path.resolve(
    path.dirname(process.execPath),
    "..",
    "Frameworks",
    `${appExecutableName} Helper.app`,
    "Contents",
    "MacOS",
    `${appExecutableName} Helper`,
  );
  return normalizeExecutablePath(helperPath);
}

function getElectronNodeModeRuntimeExecutable(): string {
  return getElectronHelperNodeRuntimeExecutable() ?? process.execPath;
}

function resolveFromCustom(): ClaudeBinaryResolution | null {
  const customPath = getCustomPath();
  if (!customPath) {
    log(
      "CLAUDE_BINARY_CUSTOM_UNSET",
      "claudeBinarySource=custom but no path is set; falling back to the built-in cli.js",
    );
    return null;
  }
  const resolved = normalizeExecutablePath(customPath);
  if (!resolved) {
    log(
      "CLAUDE_BINARY_CUSTOM_INVALID",
      `custom Claude binary path is not executable: ${customPath}; falling back to the built-in cli.js`,
    );
    return null;
  }
  return { strategy: "custom", path: resolved };
}

function resolveFromEnv(): ClaudeBinaryResolution | null {
  const envPath = getEnvOverride();
  return envPath ? { strategy: "env", path: envPath } : null;
}

function resolveFromKnownPaths(): ClaudeBinaryResolution | null {
  for (const knownPath of getKnownPaths()) {
    const resolved = normalizeExecutablePath(knownPath);
    if (resolved) return { strategy: "known", path: resolved };
  }
  return null;
}

async function resolveFromPathLookup(): Promise<ClaudeBinaryResolution | null> {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = await execFileAsync(cmd, ["claude"], { encoding: "utf-8", timeout: 5000 }) as unknown;
    const stdout = typeof result === "object" && result !== null && "stdout" in result
      ? (result as { stdout: string | Buffer }).stdout
      : result;
    const output = typeof stdout === "string" ? stdout : Buffer.isBuffer(stdout) ? stdout.toString("utf-8") : "";
    const candidates = output
      .split(/\r?\n/g)
      .map((line) => normalizeExecutablePath(line))
      .filter((candidate): candidate is string => !!candidate);
    const found = candidates[0];
    return found ? { strategy: "path", path: found } : null;
  } catch {
    return null;
  }
}

function resolveSdkFallback(): ClaudeBinaryResolution | null {
  const cliPath = getCliPath();
  return cliPath ? { strategy: "sdk-fallback", path: cliPath } : null;
}

function resolveClaudeBinarySync(options?: ResolveClaudeBinaryOptions): ClaudeBinaryResolution | null {
  const source = getSource();
  const allowSdkFallback = options?.allowSdkFallback ?? true;

  if (source === "builtin") {
    // Always the bundled SDK cli.js — deterministic, offline, no system probe and
    // no install. The allowSdkFallback flag is intentionally ignored: with this
    // source the built-in binary IS the install, so isClaudeInstalled() should
    // report it as available.
    return resolveSdkFallback();
  }

  if (source === "custom") {
    // A misconfigured custom path (empty or not executable) must not hard-fail
    // the session with a cryptic error (C1). Fall back to the bundled cli.js so
    // chats still start; the user can fix the path or switch to "built-in".
    const custom = resolveFromCustom();
    if (custom) return custom;
    return allowSdkFallback ? resolveSdkFallback() : null;
  }

  const resolution =
    resolveFromEnv() ??
    resolveFromKnownPaths();

  if (resolution) return resolution;
  if (allowSdkFallback && source === "auto") {
    return resolveSdkFallback();
  }
  return null;
}

async function resolveClaudeBinary(options?: ResolveClaudeBinaryOptions): Promise<ClaudeBinaryResolution | null> {
  const source = getSource();
  const allowSdkFallback = options?.allowSdkFallback ?? true;

  if (source === "builtin" || source === "custom") {
    return resolveClaudeBinarySync(options);
  }

  const resolution =
    resolveFromEnv() ??
    resolveFromKnownPaths();

  if (resolution) return resolution;
  const pathLookup = await resolveFromPathLookup();
  if (pathLookup) return pathLookup;
  if (allowSdkFallback && source === "auto") {
    return resolveSdkFallback();
  }
  return null;
}

async function runInstaller(command: string, args: string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      const trimmed = text.trim();
      if (trimmed) log("CLAUDE_BINARY_INSTALL_STDOUT", `${label} ${trimmed}`);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      const trimmed = text.trim();
      if (trimmed) log("CLAUDE_BINARY_INSTALL_STDERR", `${label} ${trimmed}`);
    });

    child.on("error", (err) => {
      reject(new Error(`${label} failed to start: ${extractErrorMessage(err)}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`${label} failed: ${detail}`));
    });
  });
}

async function installClaudeBinary(): Promise<string> {
  log("CLAUDE_BINARY_INSTALL_START", `platform=${process.platform}`);
  try {
    if (process.platform === "win32") {
      try {
        await runInstaller(
          "powershell",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm ${CLAUDE_INSTALL_PS1} | iex`],
          "powershell",
        );
      } catch (err) {
        reportError("CLAUDE_BINARY_INSTALL_ERR", err, { installer: "powershell" });
        await runInstaller(
          "cmd",
          ["/c", `curl -fsSL ${CLAUDE_INSTALL_CMD} -o install.cmd && install.cmd && del install.cmd`],
          "cmd",
        );
      }
    } else {
      await runInstaller(
        "bash",
        ["-lc", `curl -fsSL ${CLAUDE_INSTALL_SH} | bash`],
        process.platform,
      );
    }

    const resolution = await resolveClaudeBinary({ allowSdkFallback: false });
    if (!resolution) {
      throw new Error("Claude install completed but no executable was found on the system");
    }
    log("CLAUDE_BINARY_SELECTED", `strategy=${resolution.strategy} path=${resolution.path}`);
    return resolution.path;
  } catch (err) {
    reportError("CLAUDE_BINARY_INSTALL_ERR", err);
    throw err;
  }
}

export function isClaudeInstalled(): boolean {
  return resolveClaudeBinarySync({ installIfMissing: false, allowSdkFallback: false }) != null;
}

export async function getClaudeBinaryPath(options?: ResolveClaudeBinaryOptions): Promise<string> {
  const source = getSource();
  if (cachedSource !== source) {
    cachedPath = null;
  }

  if (cachedPath && isExecutable(cachedPath)) {
    return cachedPath;
  }

  const installIfMissing = options?.installIfMissing ?? true;
  const allowSdkFallback = options?.allowSdkFallback ?? true;

  const resolution = await resolveClaudeBinary({ installIfMissing, allowSdkFallback });
  if (resolution) {
    cachedPath = resolution.path;
    cachedSource = source;
    log("CLAUDE_BINARY_SELECTED", `strategy=${resolution.strategy} path=${resolution.path}`);
    return resolution.path;
  }

  // "builtin" must never fall through to the native claude.ai installer — it is
  // bundled-only by definition (and the installer is geo-blocked in some regions).
  if (!installIfMissing || source === "custom" || source === "builtin") {
    throw new Error(
      source === "custom"
        ? 'Claude binary not found. The custom path is unset or not executable — set a valid path in Settings → Engine, or switch the source to "built-in".'
        : "Claude executable not found",
    );
  }

  if (!installInFlight) {
    installInFlight = installClaudeBinary()
      .then((binaryPath) => {
        cachedPath = binaryPath;
        cachedSource = source;
        return binaryPath;
      })
      .finally(() => {
        installInFlight = null;
      });
  }

  try {
    const installedPath = await installInFlight;
    if (installedPath) return installedPath;
  } catch (err) {
    if (allowSdkFallback && source === "auto") {
      const fallback = resolveSdkFallback();
      if (fallback) {
        cachedPath = fallback.path;
        cachedSource = source;
        log("CLAUDE_BINARY_FALLBACK_SDK", `path=${fallback.path}`);
        return fallback.path;
      }
    }
    throw err;
  }

  if (allowSdkFallback && source === "auto") {
    const fallback = resolveSdkFallback();
    if (fallback) {
      cachedPath = fallback.path;
      cachedSource = source;
      log("CLAUDE_BINARY_FALLBACK_SDK", `path=${fallback.path}`);
      return fallback.path;
    }
  }

  throw new Error("Claude executable not found");
}

export function getClaudeBinaryStatus(): { installed: boolean; installing: boolean } {
  return {
    installed: isClaudeInstalled(),
    installing: installInFlight != null,
  };
}

/**
 * Drop the resolved-binary cache so the next resolution re-probes from scratch.
 * Used by the WeChat bridge "reconnect" action so a just-fixed binary path/source
 * takes effect without restarting the whole app. (A cached path that no longer
 * exists already self-heals via the isExecutable() guard; this also forces a
 * re-probe when the path changed but the old one is still executable.)
 */
export function resetClaudeBinaryCache(): void {
  cachedPath = null;
  cachedSource = null;
}

export function getClaudeSdkProcessOptions(cliPath: string | undefined): Record<string, unknown> & {
  env: Record<string, string>;
} {
  const options: Record<string, unknown> & { env: Record<string, string> } = {
    env: {},
  };
  if (cliPath) {
    options.pathToClaudeCodeExecutable = cliPath;
    if (isScriptExecutable(cliPath)) {
      const nodeRuntime = getNodeRuntimeExecutable();
      options.executable = nodeRuntime ?? getElectronNodeModeRuntimeExecutable();
      if (!nodeRuntime) {
        options.env.ELECTRON_RUN_AS_NODE = "1";
      }
    }
  }
  return options;
}

function readClaudeVersion(binaryPath: string): string | null {
  // When the resolved CLI is a script (the bundled SDK cli.js — the common case
  // on Windows, where getKnownPaths() is empty and resolution falls to the SDK
  // fallback), it must run via Node. We re-invoke process.execPath (the Electron
  // binary) — but WITHOUT ELECTRON_RUN_AS_NODE the packaged .exe boots a whole
  // second GUI app instead of executing cli.js: a window flashes the welcome
  // screen and this synchronous call blocks the main process until the 10s
  // timeout kills it. ELECTRON_RUN_AS_NODE=1 makes it run as plain Node;
  // windowsHide suppresses a console flash on the native-binary branch too.
  const isScript = isScriptExecutable(binaryPath);
  const nodeRuntime = isScript ? getNodeRuntimeExecutable() : null;
  const command = isScript ? nodeRuntime ?? getElectronNodeModeRuntimeExecutable() : binaryPath;
  const args = isScript ? [binaryPath, "--version"] : ["--version"];
  const output = execFileSync(command, args, {
    encoding: "utf-8",
    timeout: 10000,
    windowsHide: true,
    ...(isScript && !nodeRuntime ? { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } } : {}),
  }).trim();
  return output || null;
}

export function getClaudeBinaryMetadata(options?: ResolveClaudeBinaryOptions): {
  path: string;
  strategy: ClaudeBinaryResolutionStrategy;
  source: ClaudeBinarySource;
} | null {
  const source = getSource();
  const resolution = resolveClaudeBinarySync(options);
  if (!resolution) return null;
  return {
    path: resolution.path,
    strategy: resolution.strategy,
    source,
  };
}

export async function getClaudeBinaryInfo(): Promise<{
  path: string | null;
  origin: ClaudeBinaryResolutionStrategy | "none";
  source: ClaudeBinarySource;
  version: string | null;
  gitBash: ClaudeCodeGitBashStatus;
}> {
  const resolution = await resolveClaudeBinary({ installIfMissing: false, allowSdkFallback: true });
  return {
    path: resolution?.path ?? null,
    origin: resolution?.strategy ?? "none",
    source: getSource(),
    version: resolution ? await getClaudeVersion(resolution.path) : null,
    gitBash: getClaudeCodeGitBashStatus(process.env, process.platform, fs.existsSync, {
      userDataPath: electronApp?.getPath?.("userData"),
      resourcesPath: process.resourcesPath,
    }),
  };
}

export async function downloadClaudeUpdate(): Promise<{ version: string | null }> {
  if (!installInFlight) {
    installInFlight = installClaudeBinary()
      .then((binaryPath) => {
        cachedPath = binaryPath;
        cachedSource = getSource();
        return binaryPath;
      })
      .finally(() => {
        installInFlight = null;
      });
  }
  const binaryPath = await installInFlight;
  return { version: await getClaudeVersion(binaryPath) };
}

export async function getClaudeVersion(binaryPath?: string): Promise<string | null> {
  try {
    if (binaryPath) return readClaudeVersion(binaryPath);
    const resolution = await resolveClaudeBinary({ installIfMissing: false, allowSdkFallback: true });
    if (!resolution) return null;
    return readClaudeVersion(resolution.path);
  } catch {
    return null;
  }
}
