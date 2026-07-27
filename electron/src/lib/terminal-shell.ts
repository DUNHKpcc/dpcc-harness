import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import type { TerminalShell, TerminalShellOption } from "@shared/types/settings";

type SelectableTerminalShell = Exclude<TerminalShell, "custom">;

interface TerminalShellRuntime {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fileExists?: (filePath: string) => boolean;
  findExecutable?: (name: string) => string | null;
}

export interface ResolvedTerminalShell {
  shellPath: string;
  args: string[];
}

function defaultFileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function defaultFindExecutable(name: string): string | null {
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const output = execFileSync(command, [name], {
      encoding: "utf-8",
      timeout: 3000,
      windowsHide: true,
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function firstExisting(
  candidates: Array<string | undefined>,
  fileExists: (filePath: string) => boolean,
): string | null {
  for (const candidate of candidates) {
    if (candidate && fileExists(candidate)) return candidate;
  }
  return null;
}

function resolveNamedShell(
  shell: SelectableTerminalShell,
  runtime: TerminalShellRuntime = {},
): string | null {
  const platform = runtime.platform ?? process.platform;
  const env = runtime.env ?? process.env;
  const fileExists = runtime.fileExists ?? defaultFileExists;
  const findExecutable = runtime.findExecutable ?? defaultFindExecutable;
  const find = (name: string) => {
    const candidate = findExecutable(name);
    return candidate && fileExists(candidate) ? candidate : null;
  };

  if (shell === "auto") {
    if (platform === "win32") {
      const comSpec = env.COMSPEC || env.ComSpec;
      return firstExisting([comSpec], fileExists)
        ?? resolveNamedShell("pwsh", runtime)
        ?? resolveNamedShell("powershell", runtime)
        ?? resolveNamedShell("cmd", runtime);
    }
    return firstExisting([env.SHELL], fileExists)
      ?? resolveNamedShell(platform === "darwin" ? "zsh" : "bash", runtime)
      ?? firstExisting(["/bin/sh"], fileExists);
  }

  if (platform === "win32") {
    const winPath = path.win32;
    const systemRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    switch (shell) {
      case "pwsh":
        return firstExisting([
          winPath.join(programFiles, "PowerShell", "7", "pwsh.exe"),
          findExecutable("pwsh.exe") ?? undefined,
        ], fileExists);
      case "powershell":
        return firstExisting([
          winPath.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          findExecutable("powershell.exe") ?? undefined,
        ], fileExists);
      case "cmd":
        return firstExisting([
          env.COMSPEC || env.ComSpec,
          winPath.join(systemRoot, "System32", "cmd.exe"),
          findExecutable("cmd.exe") ?? undefined,
        ], fileExists);
      case "git-bash":
        return firstExisting([
          winPath.join(programFiles, "Git", "bin", "bash.exe"),
          env["ProgramFiles(x86)"]
            ? winPath.join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe")
            : undefined,
          env.LOCALAPPDATA
            ? winPath.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")
            : undefined,
          findExecutable("bash.exe") ?? undefined,
        ], fileExists);
      case "wsl":
        return firstExisting([
          winPath.join(systemRoot, "System32", "wsl.exe"),
          findExecutable("wsl.exe") ?? undefined,
        ], fileExists);
      default:
        return null;
    }
  }

  switch (shell) {
    case "pwsh":
      return firstExisting([
        find("pwsh") ?? undefined,
        "/opt/homebrew/bin/pwsh",
        "/usr/local/bin/pwsh",
      ], fileExists);
    case "zsh":
      return firstExisting(["/bin/zsh", find("zsh") ?? undefined], fileExists);
    case "bash":
      return firstExisting(["/bin/bash", "/usr/bin/bash", find("bash") ?? undefined], fileExists);
    case "fish":
      return firstExisting([
        find("fish") ?? undefined,
        "/opt/homebrew/bin/fish",
        "/usr/local/bin/fish",
        "/usr/bin/fish",
      ], fileExists);
    default:
      return null;
  }
}

export function resolveTerminalShell(
  shell: TerminalShell,
  customPath: string,
  runtime: TerminalShellRuntime = {},
): ResolvedTerminalShell {
  const platform = runtime.platform ?? process.platform;
  const fileExists = runtime.fileExists ?? defaultFileExists;
  if (shell === "custom") {
    const candidate = customPath.trim();
    const isAbsolute = platform === "win32"
      ? path.win32.isAbsolute(candidate)
      : path.posix.isAbsolute(candidate);
    if (!candidate || !isAbsolute || !fileExists(candidate)) {
      throw new Error("Configured terminal shell must be an existing absolute executable path");
    }
    return { shellPath: candidate, args: [] };
  }

  const shellPath = resolveNamedShell(shell, runtime);
  if (!shellPath) {
    throw new Error(`Terminal shell "${shell}" is not installed or could not be found`);
  }
  return { shellPath, args: [] };
}

export function listTerminalShellOptions(
  runtime: TerminalShellRuntime = {},
): TerminalShellOption[] {
  const platform = runtime.platform ?? process.platform;
  const shells: SelectableTerminalShell[] = platform === "win32"
    ? ["auto", "pwsh", "powershell", "cmd", "git-bash", "wsl"]
    : ["auto", "zsh", "bash", "fish", "pwsh"];

  return shells.map((shell) => {
    const resolvedPath = resolveNamedShell(shell, runtime);
    return {
      shell,
      available: resolvedPath !== null,
      ...(resolvedPath ? { path: resolvedPath } : {}),
    };
  });
}
