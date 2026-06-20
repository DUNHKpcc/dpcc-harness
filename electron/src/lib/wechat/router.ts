import os from "node:os";
import { log } from "../logger";
import type { ILinkClient } from "./ilink-client";
import type { CLIAdapter } from "./adapters/types";
import type { WeChatSessionSink } from "./session-sink";
import type { WeixinMessage } from "./types";
import type { WeChatBridgeConfig, WeChatBridgeEvent, WeChatTool, WeChatPermissionMode } from "@shared/types/wechat";

const TOOL_ALIASES: Record<string, WeChatTool> = {
  claude: "claude",
  cc: "claude",
  codex: "codex",
  cx: "codex",
};

interface UserState {
  /** Per-user engine override (sticky after an @mention or /switch). */
  defaultTool?: WeChatTool;
  /** Engine-specific resume ids so each user keeps their own conversation. */
  resumeIds: Partial<Record<WeChatTool, string>>;
  /** Permission mode the user's Codex thread was created in (gates `--last` resume). */
  codexResumeMode?: WeChatPermissionMode;
  /** Per-user model override (via /model), falls back to the global config model. */
  model?: string;
  /** Per-user permission-mode override (via /mode), falls back to the global config. */
  permissionMode?: WeChatPermissionMode;
}

interface ActiveTask {
  abort: AbortController;
  tool: WeChatTool;
}

/**
 * Routes inbound WeChat messages to the right CLI adapter and ships replies back.
 * One in-flight run per (user, tool); per-user conversation continuity via resume.
 */
export class WeChatRouter {
  private readonly active = new Map<string, ActiveTask>();
  private readonly userStates = new Map<string, UserState>();
  /**
   * Who ran Codex most recently. `codex exec resume --last` resumes the globally
   * newest thread (Codex has no per-user notion), so we only let a user resume
   * when they were the last to touch Codex — otherwise they'd grab another user's
   * thread. Best-effort isolation for the (unsafe) allow-all multi-user case.
   */
  private lastCodexUid: string | null = null;

  constructor(
    private readonly ilink: ILinkClient,
    private readonly adapters: Record<WeChatTool, CLIAdapter>,
    private readonly getConfig: () => WeChatBridgeConfig,
    private readonly emit: (event: WeChatBridgeEvent) => void,
    private readonly sink: WeChatSessionSink,
  ) {}

  start(): void {
    this.hydrateFromSink();
    this.ilink.onMessage((msg, text, refText) => {
      this.handle(msg, text, refText).catch((err) => log("WECHAT_ROUTER", `路由异常: ${(err as Error).message}`));
    });
  }

  /** Restore per-user resume ids from disk so a restart can continue threads. */
  private hydrateFromSink(): void {
    for (const rec of this.sink.allRecords()) {
      if (!rec.resumeId) continue;
      const state = this.getUserState(rec.userId);
      state.resumeIds[rec.tool] = rec.resumeId;
      if (rec.tool === "codex" && rec.codexResumeMode) state.codexResumeMode = rec.codexResumeMode;
    }
  }

  /**
   * Continue a WeChat conversation from the desktop: runs the same engine turn
   * (resuming context), streams events to the UI, and ships the reply back to
   * the WeChat user — making the desktop a second terminal on the same thread.
   */
  async runFromDesktop(pccSessionId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const rec = this.sink.getRecordBySessionId(pccSessionId);
    if (!rec) return { ok: false, error: "找不到对应的微信会话" };
    const { userId, tool } = rec;
    if (this.active.has(`${userId}:${tool}`)) {
      return { ok: false, error: `${this.adapters[tool].displayName} 正在运行中，请稍候` };
    }
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "消息为空" };

    // Fire-and-forget: events stream to the renderer, the reply goes to WeChat.
    this.exec(userId, tool, trimmed, this.getConfig()).catch((err) =>
      log("WECHAT_ROUTER", `桌面续聊失败: ${(err as Error).message}`),
    );
    return { ok: true };
  }

  /** Abort every in-flight run (shutdown / stop). */
  stop(): void {
    const seen = new Set<AbortController>();
    for (const task of this.active.values()) {
      if (!seen.has(task.abort)) {
        seen.add(task.abort);
        task.abort.abort();
      }
    }
    this.active.clear();
  }

  private getUserState(uid: string): UserState {
    let state = this.userStates.get(uid);
    if (!state) {
      state = { resumeIds: {} };
      this.userStates.set(uid, state);
    }
    return state;
  }

  private resolveTool(uid: string, config: WeChatBridgeConfig): WeChatTool {
    return this.getUserState(uid).defaultTool ?? config.defaultTool;
  }

  /**
   * Decide the resume id to hand the adapter, and claim the global Codex `--last`
   * slot for this user. Claude resumes by a real per-session id (always safe).
   * Codex `--last` is global, so it only resumes when this user ran Codex last AND
   * the permission mode is unchanged — preventing both cross-user thread leakage
   * and silently keeping a looser sandbox after the mode was tightened.
   */
  private resolveResumeId(
    uid: string,
    tool: WeChatTool,
    state: UserState,
    mode: WeChatPermissionMode,
  ): string | undefined {
    const stored = state.resumeIds[tool];
    if (tool !== "codex") return stored;

    const canResume = !!stored && this.lastCodexUid === uid && state.codexResumeMode === mode;
    // This run becomes the newest Codex thread whether it resumes or starts fresh.
    this.lastCodexUid = uid;
    return canResume ? stored : undefined;
  }

  private async handle(msg: WeixinMessage, text: string, refText: string): Promise<void> {
    const uid = msg.from_user_id;
    const config = this.getConfig();

    // Access gate: empty allowlist = allow all (surfaced as unsafe in the UI).
    if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(uid)) {
      this.emit({ type: "activity", level: "warn", message: `拒绝未授权用户 ${uid.slice(0, 12)}…` });
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    this.emit({ type: "message", direction: "in", userId: uid, tool: null, preview: trimmed.slice(0, 80) });

    if (trimmed.startsWith("/")) {
      await this.handleSlash(uid, trimmed, config);
      return;
    }

    // @mention engine selection, e.g. "@codex 帮我写..." or just "@cc" to switch.
    let tool = this.resolveTool(uid, config);
    let prompt = trimmed;
    const atMatch = trimmed.match(/^@(\w+)(?:[\s：:]\s*([\s\S]+))?$/);
    if (atMatch) {
      const alias = TOOL_ALIASES[atMatch[1].toLowerCase()];
      if (!alias) {
        await this.reply(uid, `未知引擎: @${atMatch[1]}（可用: @claude, @codex）`);
        return;
      }
      tool = alias;
      this.getUserState(uid).defaultTool = tool;
      if (!atMatch[2]) {
        await this.reply(uid, `已切换到 ${this.adapters[tool].displayName}`);
        return;
      }
      prompt = atMatch[2].trim();
    }

    if (this.active.has(`${uid}:${tool}`)) {
      await this.reply(uid, `${this.adapters[tool].displayName} 正在运行中，请稍候或发送 /cancel`);
      return;
    }

    const combined = [prompt, refText].filter(Boolean).join("\n\n");
    await this.exec(uid, tool, combined, config);
  }

  private async exec(uid: string, tool: WeChatTool, prompt: string, config: WeChatBridgeConfig): Promise<void> {
    const adapter = this.adapters[tool];
    if (!(await adapter.isAvailable())) {
      await this.reply(uid, `${adapter.displayName} 未安装，无法使用`);
      return;
    }

    const abort = new AbortController();
    this.active.set(`${uid}:${tool}`, { abort, tool });
    this.getUserState(uid).defaultTool = tool;
    const stopTyping = await this.ilink.startTyping(uid);
    const state = this.getUserState(uid);
    // Per-user overrides (via /model, /mode) take precedence over the global config.
    const mode = state.permissionMode ?? config.permissionMode;
    const model = state.model ?? config.model;
    const resumeId = this.resolveResumeId(uid, tool, state, mode);

    // Bind this turn to a persisted PccAgent session and stream events to the UI.
    const pccSessionId = await this.sink.ensureSession(uid, tool, prompt);

    try {
      const result = await adapter.execute(prompt, {
        workDir: config.workDir || os.homedir(),
        permissionMode: mode,
        model,
        maxTurns: config.maxTurns,
        resumeId,
        signal: abort.signal,
        onEvent: (raw) => this.sink.forwardEvent(pccSessionId, raw),
      });

      if (abort.signal.aborted) return;

      // Drop a stale resume id so the next message starts fresh.
      let resetNotice = "";
      if (result.sessionExpired && state.resumeIds[tool]) {
        delete state.resumeIds[tool];
        resetNotice = "[上个会话已过期，已自动开始新会话]\n\n";
      }
      if (result.resumeId) {
        state.resumeIds[tool] = result.resumeId;
        if (tool === "codex") state.codexResumeMode = mode;
      }

      // Persist the full transcript and refresh the sidebar entry.
      await this.sink.finalizeTurn(
        uid,
        tool,
        result.resumeId,
        prompt,
        result.text,
        tool === "codex" ? mode : undefined,
      );

      const footer = formatFooter(adapter.displayName, result.durationMs, result.error);
      await this.reply(uid, `${resetNotice}${result.text}\n\n${footer}`);
      this.emit({ type: "message", direction: "out", userId: uid, tool, preview: result.text.slice(0, 80) });
    } catch (err) {
      if (!abort.signal.aborted) {
        log("WECHAT_ROUTER", `${tool} 失败: ${(err as Error).message}`);
        await this.reply(uid, `运行失败: ${(err as Error).message}`);
      }
    } finally {
      stopTyping();
      this.active.delete(`${uid}:${tool}`);
    }
  }

  private async handleSlash(uid: string, text: string, config: WeChatBridgeConfig): Promise<void> {
    const parts = text.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const state = this.getUserState(uid);
    const currentTool = this.resolveTool(uid, config);

    switch (cmd) {
      case "help":
      case "h":
        await this.reply(
          uid,
          [
            "=== PccAgent 微信助手 ===",
            "直接发消息即可让当前引擎处理。",
            "",
            "【引擎】",
            "/claude /cc  切换到 Claude Code",
            "/codex /cx   切换到 Codex",
            "",
            "【模型 / 模式】",
            "/model <名称>  切换模型 (如 opus / sonnet / haiku)",
            "/model         查看当前模型",
            "/mode <模式>   切换 auto / safe / plan",
            "",
            "【会话】",
            "/status /st  查看当前状态",
            "/new /n      开始新会话 (清除上下文)",
            "/clear       清除会话与所有偏好",
            "/cancel /c   取消当前运行",
            "/help /h     显示帮助",
            "",
            "也可用 @claude / @codex 指定引擎，例如:",
            "@codex 帮我重构这个函数",
          ].join("\n"),
        );
        return;

      case "claude":
      case "cc":
        state.defaultTool = "claude";
        await this.reply(uid, "已切换到 Claude Code");
        return;

      case "codex":
      case "cx":
        state.defaultTool = "codex";
        await this.reply(uid, "已切换到 Codex");
        return;

      case "status":
      case "st": {
        const modeLabel: Record<string, string> = { auto: "auto(完整权限)", safe: "safe(只读)", plan: "plan(规划)" };
        const effMode = state.permissionMode ?? config.permissionMode;
        await this.reply(
          uid,
          [
            `引擎: ${this.adapters[currentTool].displayName}`,
            `模式: ${modeLabel[effMode] ?? effMode}`,
            `模型: ${state.model || config.model || "默认"}`,
            `目录: ${config.workDir || `${os.homedir()} (默认主目录)`}`,
            `会话: ${state.resumeIds[currentTool] ? "进行中" : "新会话"}`,
          ].join("\n"),
        );
        return;
      }

      case "model":
      case "m": {
        const arg = parts.slice(1).join(" ").trim();
        if (!arg) {
          await this.reply(
            uid,
            `当前模型: ${state.model || config.model || "默认"}\n用法: /model <名称>（如 opus / sonnet / haiku，或完整模型 id）`,
          );
          return;
        }
        state.model = arg;
        await this.reply(uid, `已切换模型: ${arg}\n（下一条消息生效，当前会话继续）`);
        return;
      }

      case "mode": {
        const arg = (parts[1] || "").toLowerCase();
        if (arg !== "auto" && arg !== "safe" && arg !== "plan") {
          await this.reply(
            uid,
            `当前模式: ${state.permissionMode ?? config.permissionMode}\n用法: /mode <auto|safe|plan>\nauto=完整权限 safe=只读 plan=规划`,
          );
          return;
        }
        state.permissionMode = arg;
        await this.reply(uid, `已切换模式: ${arg}`);
        return;
      }

      case "new":
      case "n":
        delete state.resumeIds[currentTool];
        await this.reply(uid, `已开始新的 ${this.adapters[currentTool].displayName} 会话`);
        return;

      case "clear":
        state.resumeIds = {};
        state.defaultTool = undefined;
        state.model = undefined;
        state.permissionMode = undefined;
        await this.reply(uid, "已清除会话与所有偏好");
        return;

      case "cancel":
      case "c":
      case "stop": {
        const tasks = [...this.active.entries()].filter(([k]) => k.startsWith(`${uid}:`));
        if (tasks.length === 0) {
          await this.reply(uid, "当前没有正在运行的任务");
          return;
        }
        const seen = new Set<AbortController>();
        for (const [key, task] of tasks) {
          if (!seen.has(task.abort)) {
            seen.add(task.abort);
            task.abort.abort();
          }
          this.active.delete(key);
        }
        await this.reply(uid, "已取消当前任务");
        return;
      }

      default:
        await this.reply(uid, `未知命令: /${cmd}\n发送 /help 查看可用命令`);
        return;
    }
  }

  private async reply(uid: string, text: string): Promise<void> {
    try {
      await this.ilink.sendText(uid, text);
    } catch (err) {
      log("WECHAT_ROUTER", `发送回复失败: ${(err as Error).message}`);
    }
  }
}

function formatFooter(displayName: string, durationMs: number, error: boolean): string {
  const secs = Math.round(durationMs / 1000);
  const dur = secs >= 60 ? `${Math.floor(secs / 60)}m${secs % 60}s` : `${secs}s`;
  return `— ${displayName} · ${dur}${error ? " · 出错" : ""}`;
}
