import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { log } from "../../logger";
import { reportError } from "../../error-utils";
import { getCodexBinaryPath, isCodexInstalled } from "../../codex-binary";
import { killProcessTree } from "../../process-tree";
import { isSessionError } from "./session-error";
import type { CLIAdapter, AdapterExecOptions, AdapterExecResult } from "./types";

const HARD_TIMEOUT_MS = 10 * 60 * 1000; // safety cap; /cancel aborts sooner via signal

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;

/**
 * Runs Codex via `codex exec` (non-interactive batch mode) as a one-shot run.
 * Uses the user's native Codex login/config; resumes the last thread when a
 * prior run exists for the user.
 */
export class CodexAdapter implements CLIAdapter {
  readonly name = "codex" as const;
  readonly displayName = "Codex CLI";

  async isAvailable(): Promise<boolean> {
    return isCodexInstalled();
  }

  async execute(prompt: string, opts: AdapterExecOptions): Promise<AdapterExecResult> {
    const start = Date.now();
    let codexPath: string;
    try {
      codexPath = await getCodexBinaryPath();
    } catch (err) {
      const errMsg = reportError("WECHAT_CODEX_ERR", err, { context: "binary-path" });
      return { text: `无法找到 Codex CLI: ${errMsg}`, error: true, durationMs: Date.now() - start };
    }

    const args = buildArgs(opts);
    const isResumeRun = args.includes("resume");
    log("WECHAT_CODEX", `run mode=${opts.permissionMode} resume=${isResumeRun ? "last" : "none"} args=${args.join(" ")}`);

    return new Promise<AdapterExecResult>((resolve) => {
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(codexPath, args, {
          cwd: opts.workDir,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });
      } catch (err) {
        const errMsg = reportError("WECHAT_CODEX_ERR", err, { context: "spawn" });
        resolve({ text: `无法启动 Codex CLI: ${errMsg}`, error: true, durationMs: Date.now() - start });
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (result: AdapterExecResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const onAbort = () => {
        killProcessTree(proc);
        finish({ text: "已取消", error: true, durationMs: Date.now() - start });
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });

      const timer = setTimeout(() => {
        killProcessTree(proc);
        finish({ text: "运行超时", error: true, durationMs: Date.now() - start });
      }, HARD_TIMEOUT_MS);

      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      proc.stdout.on("data", (d: string) => {
        stdout += d;
      });
      proc.stderr.on("data", (d: string) => {
        stderr += d;
      });

      // Pass the prompt via stdin to avoid shell-escaping issues.
      try {
        proc.stdin.write(prompt);
        proc.stdin.end();
      } catch {
        /* stdin may already be closed if spawn failed */
      }

      proc.on("close", (code) => {
        const text = stripAnsi((stdout.trim() || stderr.trim()) || `exit ${code}`);
        // Only treat a failed resume as an expired session when the output actually
        // says so — a generic non-zero exit (lint/test failure, transient error)
        // must NOT discard the user's thread.
        const sessionExpired = code !== 0 && !!opts.resumeId && isSessionError(text);
        finish({
          text: text || "(无输出)",
          resumeId: code === 0 ? "last" : undefined,
          error: code !== 0,
          durationMs: Date.now() - start,
          sessionExpired,
        });
      });

      proc.on("error", (err) => {
        finish({ text: `无法启动 Codex CLI: ${err.message}`, error: true, durationMs: Date.now() - start });
      });
    });
  }
}

function buildArgs(opts: AdapterExecOptions): string[] {
  if (opts.resumeId === "last") {
    // Resume the most recent thread; sandbox/model flags are inherited from it.
    return ["exec", "resume", "--last"];
  }

  const args = ["exec"];
  if (opts.permissionMode === "auto") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    // "safe" and "plan" are both read-only: there is no human at a phone to
    // approve writes, so anything short of "auto" must NOT mutate the workspace.
    // (`--full-auto` would grant workspace-write — contradicting the UI label.)
    args.push("--sandbox", "read-only");
  }
  args.push("--skip-git-repo-check");
  if (opts.model) args.push("-m", opts.model);
  return args;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}
