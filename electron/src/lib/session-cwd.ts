import os from "os";

export function normalizeSessionCwd(cwd: string | null | undefined, fallback: string = os.homedir()): string {
  return cwd?.trim() || fallback;
}
