import { execFile, type ExecFileException } from "child_process";

export const ALWAYS_SKIP = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", ".next", ".nuxt",
  ".output", ".cache", ".turbo", ".parcel-cache", ".vercel", ".netlify",
  "__pycache__", ".pytest_cache", ".mypy_cache", "venv", ".venv", "env",
  ".tox", "coverage", ".nyc_output", ".angular", ".expo", "Pods",
  ".gradle", ".idea", ".vs", ".vscode", "target", "out", "bin", "obj",
]);

export type GitExecErrorKind = "git-not-found" | "not-git-repository" | "git-command-failed";

export class GitExecError extends Error {
  readonly kind: GitExecErrorKind;
  readonly command: string;
  readonly stderr: string;
  readonly code?: string;

  constructor(
    kind: GitExecErrorKind,
    message: string,
    args: string[],
    options?: { stderr?: string; code?: string },
  ) {
    super(message);
    this.name = "GitExecError";
    this.kind = kind;
    this.command = ["git", ...args].join(" ");
    this.stderr = options?.stderr ?? "";
    this.code = options?.code;
  }
}

function gitErrorFromExec(args: string[], err: ExecFileException, stderr = ""): GitExecError {
  const trimmedStderr = stderr.trim();
  const code = typeof err.code === "string" ? err.code : undefined;
  if (code === "ENOENT") {
    return new GitExecError(
      "git-not-found",
      "Git executable not found. Install Git or add it to PATH.",
      args,
      { stderr: trimmedStderr, code },
    );
  }
  if (trimmedStderr.includes("fatal: not a git repository")) {
    return new GitExecError(
      "not-git-repository",
      trimmedStderr,
      args,
      { stderr: trimmedStderr, code },
    );
  }
  return new GitExecError(
    "git-command-failed",
    trimmedStderr || err.message,
    args,
    { stderr: trimmedStderr, code },
  );
}

export function isGitExecError(err: unknown): err is GitExecError {
  return err instanceof GitExecError;
}

export function isGitNotFoundError(err: unknown): err is GitExecError {
  return isGitExecError(err) && err.kind === "git-not-found";
}

export function isNotGitRepositoryError(err: unknown): err is GitExecError {
  return isGitExecError(err) && err.kind === "not-git-repository";
}

export function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(gitErrorFromExec(args, err, stderr));
      resolve(stdout);
    });
  });
}
