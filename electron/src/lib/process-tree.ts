import { execFileSync } from "child_process";

interface ProcessLike {
  pid?: number;
  kill: (signal?: NodeJS.Signals) => unknown;
}

const DEFAULT_TIMEOUT_MS = 1000;

function listChildPids(pid: number): number[] {
  try {
    const output = execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DEFAULT_TIMEOUT_MS,
    });
    return output
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function collectDescendantPids(pid: number, seen = new Set<number>()): number[] {
  const descendants: number[] = [];
  for (const childPid of listChildPids(pid)) {
    if (seen.has(childPid)) continue;
    seen.add(childPid);
    descendants.push(...collectDescendantPids(childPid, seen), childPid);
  }
  return descendants;
}

function killPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    /* already dead */
  }
}

export function killProcessTree(proc: ProcessLike | number | null | undefined, signal: NodeJS.Signals = "SIGTERM"): void {
  if (proc == null) return;
  const pid = typeof proc === "number" ? proc : proc.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: DEFAULT_TIMEOUT_MS,
      });
    } catch {
      if (typeof proc === "number") killPid(pid, signal);
      else {
        try {
          proc.kill(signal);
        } catch {
          /* already dead */
        }
      }
    }
    return;
  }

  for (const childPid of collectDescendantPids(pid)) {
    killPid(childPid, signal);
  }

  if (typeof proc === "number") {
    killPid(pid, signal);
    return;
  }
  try {
    proc.kill(signal);
  } catch {
    /* already dead */
  }
}
