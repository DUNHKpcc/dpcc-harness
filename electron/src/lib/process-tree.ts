import { execFileSync } from "child_process";

interface ProcessLike {
  pid?: number;
  kill: (signal?: NodeJS.Signals) => unknown;
}

const DEFAULT_TIMEOUT_MS = 1000;

function listChildPidsWithPgrep(pid: number): number[] {
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

function listUnixProcessChildren(): Map<number, number[]> | null {
  try {
    const output = execFileSync("ps", ["-A", "-o", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const childrenByParent = new Map<number, number[]>();
    for (const line of output.split(/\r?\n/)) {
      const [pidText, parentPidText] = line.trim().split(/\s+/, 2);
      const childPid = Number.parseInt(pidText, 10);
      const parentPid = Number.parseInt(parentPidText, 10);
      if (!Number.isInteger(childPid) || childPid <= 0) continue;
      if (!Number.isInteger(parentPid) || parentPid < 0) continue;
      const children = childrenByParent.get(parentPid) ?? [];
      children.push(childPid);
      childrenByParent.set(parentPid, children);
    }
    return childrenByParent;
  } catch {
    return null;
  }
}

function collectDescendantPids(
  pid: number,
  childrenByParent: Map<number, number[]> | null,
  seen = new Set<number>(),
): number[] {
  const descendants: number[] = [];
  const childPids = childrenByParent
    ? (childrenByParent.get(pid) ?? [])
    : listChildPidsWithPgrep(pid);
  for (const childPid of childPids) {
    if (seen.has(childPid)) continue;
    seen.add(childPid);
    descendants.push(...collectDescendantPids(childPid, childrenByParent, seen), childPid);
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

  const childrenByParent = listUnixProcessChildren();
  for (const childPid of collectDescendantPids(pid, childrenByParent)) {
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
