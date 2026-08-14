import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import type {
  TerminalShell,
  TerminalShellDetectionSource,
  TerminalShellDiagnosticCode,
  TerminalShellOption,
  TerminalShellValidationErrorCode,
  TerminalShellValidationResult,
} from "@shared/types/settings";

type SelectableTerminalShell = Exclude<TerminalShell, "custom">;

interface ShellCandidate {
  path: string;
  source: TerminalShellDetectionSource;
}

interface PowerShellProbeResult {
  valid: boolean;
  version?: string;
  error?: string;
}

interface ShellDiscoveryResult {
  path: string | null;
  source?: TerminalShellDetectionSource;
  version?: string;
  diagnosticCode?: TerminalShellDiagnosticCode;
  diagnostic?: string;
}

interface TerminalShellRuntime {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fileExists?: (filePath: string) => boolean;
  fileIsExecutable?: (filePath: string) => boolean;
  findExecutable?: (name: string, env?: NodeJS.ProcessEnv) => string | null;
  readWindowsPathEntries?: (env: NodeJS.ProcessEnv) => string[];
  discoverWindowsPowerShellLocations?: (env: NodeJS.ProcessEnv) => ShellCandidate[];
  probePowerShell?: (filePath: string) => PowerShellProbeResult;
}

export interface ResolvedTerminalShell {
  shellPath: string;
  args: string[];
}

export class TerminalShellResolutionError extends Error {
  constructor(
    message: string,
    readonly code?: TerminalShellValidationErrorCode,
  ) {
    super(message);
    this.name = "TerminalShellResolutionError";
  }
}

function defaultFileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function defaultFileIsExecutable(filePath: string, platform: NodeJS.Platform): boolean {
  if (!defaultFileExists(filePath)) return false;
  if (platform === "win32") return true;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeExecutablePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function defaultFindExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | null {
  try {
    const systemRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
    const command = platform === "win32"
      ? path.win32.join(systemRoot, "System32", "where.exe")
      : "which";
    const output = execFileSync(command, [name], {
      encoding: "utf-8",
      env,
      timeout: 3000,
      windowsHide: true,
    });
    return output
      .split(/\r?\n/)
      .map(normalizeExecutablePath)
      .find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function expandWindowsEnvironmentVariables(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    const exact = env[name];
    if (exact !== undefined) return exact;
    const key = Object.keys(env).find((entry) => entry.toLowerCase() === name.toLowerCase());
    return key ? (env[key] ?? match) : match;
  });
}

function queryWindowsRegistryValues(
  key: string,
  valueName: string,
  env: NodeJS.ProcessEnv,
  recursive = false,
): string[] {
  try {
    const systemRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
    const regExe = path.win32.join(systemRoot, "System32", "reg.exe");
    const args = ["query", key, ...(recursive ? ["/s"] : []), "/v", valueName];
    const output = execFileSync(regExe, args, {
      encoding: "utf-8",
      env,
      timeout: 2500,
      windowsHide: true,
    });
    const escapedName = valueName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const valuePattern = new RegExp(`^\\s*${escapedName}\\s+REG_\\w+\\s+(.+?)\\s*$`, "i");
    return output
      .split(/\r?\n/)
      .map((line) => line.match(valuePattern)?.[1]?.trim())
      .filter((value): value is string => !!value);
  } catch {
    return [];
  }
}

function defaultReadWindowsPathEntries(env: NodeJS.ProcessEnv): string[] {
  const machine = queryWindowsRegistryValues(
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    "Path",
    env,
  );
  const user = queryWindowsRegistryValues("HKCU\\Environment", "Path", env);
  return [...machine, ...user]
    .flatMap((value) => expandWindowsEnvironmentVariables(value, env).split(";"))
    .map((value) => value.trim())
    .filter(Boolean);
}

function readAppxPowerShellLocations(env: NodeJS.ProcessEnv): string[] {
  try {
    const systemRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
    const powershell = path.win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const output = execFileSync(powershell, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='SilentlyContinue'; Get-AppxPackage -Name 'Microsoft.PowerShell*' | Select-Object -ExpandProperty InstallLocation",
    ], {
      encoding: "utf-8",
      env,
      timeout: 3500,
      windowsHide: true,
    });
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function defaultDiscoverWindowsPowerShellLocations(env: NodeJS.ProcessEnv): ShellCandidate[] {
  const registryLocations = [
    ...queryWindowsRegistryValues(
      "HKLM\\SOFTWARE\\Microsoft\\PowerShellCore\\InstalledVersions",
      "InstallLocation",
      env,
      true,
    ),
    ...queryWindowsRegistryValues(
      "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\PowerShellCore\\InstalledVersions",
      "InstallLocation",
      env,
      true,
    ),
  ];
  return [
    ...registryLocations.map((location) => ({
      path: path.win32.join(expandWindowsEnvironmentVariables(location, env), "pwsh.exe"),
      source: "registry" as const,
    })),
    ...readAppxPowerShellLocations(env).map((location) => ({
      path: path.win32.join(location, "pwsh.exe"),
      source: "app-alias" as const,
    })),
  ];
}

function defaultProbePowerShell(filePath: string): PowerShellProbeResult {
  try {
    const output = execFileSync(filePath, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[string]$PSVersionTable.PSVersion.Major + '|' + [string]$PSVersionTable.PSVersion",
    ], {
      encoding: "utf-8",
      timeout: 3000,
      windowsHide: true,
    }).trim();
    const [majorText, version] = output.split("|", 2);
    const major = Number.parseInt(majorText, 10);
    if (!Number.isFinite(major) || major < 7) {
      return { valid: false, error: `Expected PowerShell 7+, received ${output || "no version"}` };
    }
    return { valid: true, version: version || majorText };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function dedupeCandidates(
  candidates: Array<ShellCandidate | null | undefined>,
  platform: NodeJS.Platform,
): ShellCandidate[] {
  const seen = new Set<string>();
  const result: ShellCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate?.path) continue;
    const normalizedPath = normalizeExecutablePath(candidate.path);
    const key = platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
    if (!normalizedPath || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...candidate, path: normalizedPath });
  }
  return result;
}

function buildWindowsSearchEnv(
  env: NodeJS.ProcessEnv,
  readWindowsPathEntries: (env: NodeJS.ProcessEnv) => string[],
): NodeJS.ProcessEnv {
  const inheritedPath = env.Path || env.PATH || "";
  const windowsApps = env.LOCALAPPDATA
    ? path.win32.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps")
    : "";
  const pathEntries = [
    ...inheritedPath.split(";"),
    ...readWindowsPathEntries(env),
    windowsApps,
  ].map((value) => value.trim()).filter(Boolean);
  const deduped = [...new Map(pathEntries.map((entry) => [entry.toLowerCase(), entry])).values()];
  const mergedPath = deduped.join(";");
  return { ...env, Path: mergedPath, PATH: mergedPath };
}

export function getTerminalSpawnEnvironment(
  runtime: TerminalShellRuntime = {},
): NodeJS.ProcessEnv {
  const platform = runtime.platform ?? process.platform;
  const env = runtime.env ?? process.env;
  if (platform !== "win32") return { ...env };
  return buildWindowsSearchEnv(
    env,
    runtime.readWindowsPathEntries ?? defaultReadWindowsPathEntries,
  );
}

function getRuntimeHelpers(runtime: TerminalShellRuntime) {
  const platform = runtime.platform ?? process.platform;
  const env = runtime.env ?? process.env;
  const fileExists = runtime.fileExists ?? defaultFileExists;
  const fileIsExecutable = runtime.fileIsExecutable
    ?? runtime.fileExists
    ?? ((filePath: string) => defaultFileIsExecutable(filePath, platform));
  const findExecutable = runtime.findExecutable
    ?? ((name: string, searchEnv = env) => defaultFindExecutable(name, searchEnv, platform));
  return { platform, env, fileExists, fileIsExecutable, findExecutable };
}

function discoverPowerShell(runtime: TerminalShellRuntime): ShellDiscoveryResult {
  const { platform, env, fileIsExecutable, findExecutable } = getRuntimeHelpers(runtime);
  const probePowerShell = runtime.probePowerShell ?? defaultProbePowerShell;
  const candidates: ShellCandidate[] = [];
  let lastProbeError: string | undefined;
  const tryCandidates = (): ShellDiscoveryResult | null => {
    for (const candidate of dedupeCandidates(candidates, platform)) {
      if (!fileIsExecutable(candidate.path)) continue;
      const probe = probePowerShell(candidate.path);
      if (probe.valid) {
        return {
          path: candidate.path,
          source: candidate.source,
          version: probe.version,
        };
      }
      lastProbeError = probe.error;
    }
    return null;
  };

  if (platform === "win32") {
    const winPath = path.win32;
    const readWindowsPathEntries = runtime.readWindowsPathEntries ?? defaultReadWindowsPathEntries;
    const searchEnv = buildWindowsSearchEnv(env, readWindowsPathEntries);
    const fromPath = findExecutable("pwsh.exe", searchEnv);
    const programFiles = [
      env.ProgramW6432,
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
      "C:\\Program Files",
    ].filter((value): value is string => !!value);
    const localAppData = env.LOCALAPPDATA;
    const userProfile = env.USERPROFILE;
    const chocolateyInstall = env.ChocolateyInstall || "C:\\ProgramData\\chocolatey";

    candidates.push(
      ...(fromPath ? [{ path: fromPath, source: "path" as const }] : []),
      ...programFiles.map((root) => ({
        path: winPath.join(root, "PowerShell", "7", "pwsh.exe"),
        source: "known-location" as const,
      })),
      ...(localAppData ? [{
        path: winPath.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe"),
        source: "app-alias" as const,
      }, {
        path: winPath.join(localAppData, "Programs", "PowerShell", "7", "pwsh.exe"),
        source: "known-location" as const,
      }] : []),
      ...(userProfile ? [{
        path: winPath.join(userProfile, ".dotnet", "tools", "pwsh.exe"),
        source: "package-manager" as const,
      }, {
        path: winPath.join(userProfile, "scoop", "shims", "pwsh.exe"),
        source: "package-manager" as const,
      }] : []),
      ...(env.SCOOP ? [{
        path: winPath.join(env.SCOOP, "shims", "pwsh.exe"),
        source: "package-manager" as const,
      }] : []),
      {
        path: winPath.join(chocolateyInstall, "bin", "pwsh.exe"),
        source: "package-manager" as const,
      },
      ...programFiles.map((root) => ({
        path: winPath.join(root, "PowerShell", "7-preview", "pwsh.exe"),
        source: "known-location" as const,
      })),
    );
    const knownResult = tryCandidates();
    if (knownResult) return knownResult;

    candidates.length = 0;
    candidates.push(...(runtime.discoverWindowsPowerShellLocations
      ?? defaultDiscoverWindowsPowerShellLocations)(env));
  } else {
    const fromPath = findExecutable("pwsh", env);
    candidates.push(
      ...(fromPath ? [{ path: fromPath, source: "path" as const }] : []),
      { path: "/opt/homebrew/bin/pwsh", source: "known-location" },
      { path: "/usr/local/bin/pwsh", source: "known-location" },
      ...(env.HOME ? [{
        path: path.posix.join(env.HOME, ".dotnet", "tools", "pwsh"),
        source: "package-manager" as const,
      }] : []),
    );
  }

  const discoveredResult = tryCandidates();
  if (discoveredResult) return discoveredResult;

  return {
    path: null,
    diagnosticCode: lastProbeError ? "launch-failed" : "not-found",
    diagnostic: lastProbeError
      ? `PowerShell was found but could not be started: ${lastProbeError}`
      : "PowerShell 7 was not found in PATH, package registrations, or known install locations.",
  };
}

function discoverNamedShell(
  shell: SelectableTerminalShell,
  runtime: TerminalShellRuntime = {},
): ShellDiscoveryResult {
  const { platform, env, fileIsExecutable, findExecutable } = getRuntimeHelpers(runtime);
  const resolveCandidate = (
    candidates: Array<ShellCandidate | null | undefined>,
  ): ShellDiscoveryResult => {
    const found = dedupeCandidates(candidates, platform)
      .find((candidate) => fileIsExecutable(candidate.path));
    return found
      ? { path: found.path, source: found.source }
      : { path: null };
  };
  const find = (name: string): ShellCandidate | null => {
    const candidate = findExecutable(name, env);
    return candidate ? { path: candidate, source: "path" } : null;
  };

  if (shell === "auto") {
    if (platform === "win32") {
      const comSpec = env.COMSPEC || env.ComSpec;
      const systemDefault = resolveCandidate(comSpec ? [{
        path: comSpec,
        source: "system-default",
      }] : []);
      if (systemDefault.path) return systemDefault;
      const pwsh = discoverPowerShell(runtime);
      if (pwsh.path) return pwsh;
      const powershell = discoverNamedShell("powershell", runtime);
      if (powershell.path) return powershell;
      return discoverNamedShell("cmd", runtime);
    }
    const systemDefault = resolveCandidate(env.SHELL ? [{
      path: env.SHELL,
      source: "system-default",
    }] : []);
    if (systemDefault.path) return systemDefault;
    const fallback = discoverNamedShell(platform === "darwin" ? "zsh" : "bash", runtime);
    return fallback.path ? fallback : resolveCandidate([{
      path: "/bin/sh",
      source: "known-location",
    }]);
  }

  if (shell === "pwsh") return discoverPowerShell(runtime);

  if (platform === "win32") {
    const winPath = path.win32;
    const systemRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    switch (shell) {
      case "powershell":
        return resolveCandidate([
          {
            path: winPath.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
            source: "known-location",
          },
          find("powershell.exe"),
        ]);
      case "cmd":
        return resolveCandidate([
          ...(env.COMSPEC || env.ComSpec ? [{
            path: env.COMSPEC || env.ComSpec || "",
            source: "system-default" as const,
          }] : []),
          {
            path: winPath.join(systemRoot, "System32", "cmd.exe"),
            source: "known-location",
          },
          find("cmd.exe"),
        ]);
      case "git-bash":
        return resolveCandidate([
          {
            path: winPath.join(programFiles, "Git", "bin", "bash.exe"),
            source: "known-location",
          },
          env["ProgramFiles(x86)"] ? {
            path: winPath.join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
            source: "known-location",
          } : null,
          env.LOCALAPPDATA ? {
            path: winPath.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
            source: "known-location",
          } : null,
          find("bash.exe"),
        ]);
      case "wsl":
        return resolveCandidate([
          {
            path: winPath.join(systemRoot, "System32", "wsl.exe"),
            source: "known-location",
          },
          find("wsl.exe"),
        ]);
      default:
        return { path: null };
    }
  }

  switch (shell) {
    case "zsh":
      return resolveCandidate([
        { path: "/bin/zsh", source: "known-location" },
        find("zsh"),
      ]);
    case "bash":
      return resolveCandidate([
        { path: "/bin/bash", source: "known-location" },
        { path: "/usr/bin/bash", source: "known-location" },
        find("bash"),
      ]);
    case "fish":
      return resolveCandidate([
        find("fish"),
        { path: "/opt/homebrew/bin/fish", source: "known-location" },
        { path: "/usr/local/bin/fish", source: "known-location" },
        { path: "/usr/bin/fish", source: "known-location" },
      ]);
    default:
      return { path: null };
  }
}

export function validateCustomTerminalShellPath(
  customPath: string,
  runtime: TerminalShellRuntime = {},
): TerminalShellValidationResult {
  const { platform, fileExists, fileIsExecutable } = getRuntimeHelpers(runtime);
  const candidate = normalizeExecutablePath(customPath);
  if (!candidate) {
    return { valid: false, errorCode: "empty", error: "Select a shell executable." };
  }
  const isAbsolute = platform === "win32"
    ? path.win32.isAbsolute(candidate)
    : path.posix.isAbsolute(candidate);
  if (!isAbsolute) {
    return {
      valid: false,
      errorCode: "not_absolute",
      error: "The terminal shell path must be absolute.",
    };
  }
  if (platform === "win32" && path.win32.extname(candidate).toLowerCase() !== ".exe") {
    return {
      valid: false,
      errorCode: "windows_requires_exe",
      error: "Windows terminal shells must point to an .exe file.",
    };
  }
  if (!fileExists(candidate)) {
    return {
      valid: false,
      errorCode: "not_found",
      error: "The selected terminal shell does not exist.",
    };
  }
  if (!fileIsExecutable(candidate)) {
    return {
      valid: false,
      errorCode: "not_executable",
      error: "The selected file is not executable.",
    };
  }
  return { valid: true, path: candidate };
}

export function resolveTerminalShell(
  shell: TerminalShell,
  customPath: string,
  runtime: TerminalShellRuntime = {},
): ResolvedTerminalShell {
  if (shell === "custom") {
    const validation = validateCustomTerminalShellPath(customPath, runtime);
    if (!validation.valid || !validation.path) {
      throw new TerminalShellResolutionError(
        validation.error || "The configured terminal shell is invalid.",
        validation.errorCode,
      );
    }
    return { shellPath: validation.path, args: [] };
  }

  const resolved = discoverNamedShell(shell, runtime);
  if (!resolved.path) {
    throw new TerminalShellResolutionError(
      resolved.diagnostic || `Terminal shell "${shell}" is not installed or could not be found`,
    );
  }
  return { shellPath: resolved.path, args: [] };
}

export function listTerminalShellOptions(
  runtime: TerminalShellRuntime = {},
): TerminalShellOption[] {
  const platform = runtime.platform ?? process.platform;
  const shells: SelectableTerminalShell[] = platform === "win32"
    ? ["auto", "pwsh", "powershell", "cmd", "git-bash", "wsl"]
    : ["auto", "zsh", "bash", "fish", "pwsh"];

  return shells.map((shell) => {
    const resolved = discoverNamedShell(shell, runtime);
    return {
      shell,
      available: resolved.path !== null,
      ...(resolved.path ? { path: resolved.path } : {}),
      ...(resolved.source ? { source: resolved.source } : {}),
      ...(resolved.version ? { version: resolved.version } : {}),
      ...(resolved.diagnosticCode ? { diagnosticCode: resolved.diagnosticCode } : {}),
      ...(resolved.diagnostic ? { diagnostic: resolved.diagnostic } : {}),
    };
  });
}
