import { log } from "../../logger";
import { reportError } from "../../error-utils";
import { getSDK } from "../../sdk";
import { getClaudeBinaryPath, isClaudeInstalled } from "../../claude-binary";
import { claudeSpawnEnv, claudeGatewayModel } from "../../claude-gateway-env";
import { isSessionError } from "./session-error";
import type { CLIAdapter, AdapterExecOptions, AdapterExecResult } from "./types";

/**
 * Tools allowed in "safe" mode — read-only / non-mutating. Everything else is
 * denied so a remote phone session can't silently edit files or run shell
 * commands without the user switching to "auto".
 */
const SAFE_MODE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "WebFetch",
  "WebSearch",
  "NotebookRead",
  "TodoWrite",
  "Task",
]);

/** Runs Claude Code via the bundled Agent SDK as a one-shot, resumable query. */
export class ClaudeAdapter implements CLIAdapter {
  readonly name = "claude" as const;
  readonly displayName = "Claude Code";

  async isAvailable(): Promise<boolean> {
    return isClaudeInstalled();
  }

  async execute(prompt: string, opts: AdapterExecOptions): Promise<AdapterExecResult> {
    const start = Date.now();
    const query = await getSDK();
    const cliPath = await getClaudeBinaryPath();

    const permissionMode =
      opts.permissionMode === "auto"
        ? "bypassPermissions"
        : opts.permissionMode === "plan"
          ? "plan"
          : "default";

    const sdkOpts: Record<string, unknown> = {
      cwd: opts.workDir,
      maxTurns: opts.maxTurns,
      permissionMode,
      pathToClaudeCodeExecutable: cliPath,
      persistSession: true,
      // Emit partial streaming events so the desktop UI renders WeChat runs
      // token-by-token, matching a normal session's feel.
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      // Authenticate phone-initiated runs against the same upstream as interactive
      // sessions (gateway > local > DPCC default) — without it the gateway returns
      // "not login" for every WeChat message (B4).
      env: claudeSpawnEnv(),
    };
    if (opts.model) sdkOpts.model = opts.model;
    // Gateway custom model overrides the configured model when enabled — the
    // gateway only serves its own model, mirroring interactive session behavior.
    const gatewayModel = claudeGatewayModel();
    if (gatewayModel) sdkOpts.model = gatewayModel;
    if (opts.resumeId) sdkOpts.resume = opts.resumeId;

    // In "safe" mode, gate every mutating tool. Read-only tools pass through so
    // the agent can still investigate and answer without write access.
    if (opts.permissionMode === "safe") {
      sdkOpts.canUseTool = async (toolName: string, input: Record<string, unknown>) => {
        if (SAFE_MODE_TOOLS.has(toolName)) {
          return { behavior: "allow" as const, updatedInput: input };
        }
        return {
          behavior: "deny" as const,
          message: "安全模式下禁止该操作（在设置中切换到 auto 模式以启用完整权限）",
        };
      };
    }

    log(
      "WECHAT_CLAUDE",
      `run mode=${opts.permissionMode} model=${(sdkOpts.model as string | undefined) || "default"} resume=${opts.resumeId ? opts.resumeId.slice(0, 8) : "none"}`,
    );

    let resultText = "";
    let assistantText = "";
    let sessionId: string | undefined;
    let error = false;

    try {
      const q = query({ prompt, options: sdkOpts as Parameters<typeof query>[0]["options"] });

      const onAbort = () => {
        try {
          q.close();
        } catch {
          /* already closed */
        }
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });

      try {
        for await (const message of q) {
          if (opts.signal.aborted) break;
          const msg = message as Record<string, unknown>;

          // Forward the raw SDK event so the desktop UI can stream this run live.
          opts.onEvent?.(message);

          if (msg.type === "assistant") {
            const content = extractAssistantText(msg);
            if (content) {
              assistantText += content;
              opts.onIntermediate?.(content);
            }
          }

          if (msg.type === "result") {
            resultText = typeof msg.result === "string" ? msg.result : "";
            sessionId = typeof msg.session_id === "string" ? msg.session_id : undefined;
            error = !!msg.is_error || msg.subtype !== "success";
          }
        }
      } finally {
        opts.signal.removeEventListener("abort", onAbort);
      }
    } catch (err) {
      const errMsg = reportError("WECHAT_CLAUDE_ERR", err, { context: "execute" });
      // A throw while resuming that looks like a session/resume failure means the
      // stored resume id is dead — flag it so the router drops it (else every
      // future message re-fails on the same bad id). Keep it on transient errors.
      return {
        text: `运行失败: ${errMsg}`,
        error: true,
        durationMs: Date.now() - start,
        sessionExpired: !!opts.resumeId && isSessionError(errMsg),
      };
    }

    if (opts.signal.aborted) {
      return { text: "已取消", error: true, durationMs: Date.now() - start };
    }

    const text = resultText.trim() || assistantText.trim() || "(无输出)";
    // Only a session/resume-specific failure expires the id. A turn that merely
    // errored (e.g. max_turns) keeps its session_id so the user can continue it.
    const sessionExpired = error && !!opts.resumeId && isSessionError(text);
    return {
      text,
      resumeId: sessionExpired ? undefined : sessionId,
      error,
      durationMs: Date.now() - start,
      sessionExpired,
    };
  }
}

/** Pull text from an `assistant` SDK message's content blocks. */
function extractAssistantText(msg: Record<string, unknown>): string {
  const message = msg.message;
  const content =
    message && typeof message === "object" && "content" in message
      ? (message as { content?: unknown }).content
      : undefined;
  if (!Array.isArray(content)) return "";

  let out = "";
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") out += text;
    }
  }
  return out;
}
