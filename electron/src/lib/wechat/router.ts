import crypto from "node:crypto";
import os from "node:os";
import { extractErrorDetails } from "../error-utils";
import { log } from "../logger";
import type { CLIAdapter } from "./adapters/types";
import type { ILinkClient } from "./ilink-client";
import type { WeChatSessionSink } from "./session-sink";
import type { WeixinMessage } from "./types";
import type {
  WeChatBridgeConfig,
  WeChatBridgeEvent,
  WeChatPermissionMode,
} from "@shared/types/wechat";

const LEGACY_ALIASES = new Set(["claude", "cc", "codex", "cx"]);
const LEGACY_MIGRATION_MESSAGE = "Claude Code/Codex 微信 runtime 已移除，请使用 @pi 或直接发送消息。";

interface UserState {
  resumeId?: string;
  model?: string;
  permissionMode?: WeChatPermissionMode;
}

interface ActiveTask {
  abort: AbortController;
  pccSessionId?: string;
}

/** Routes each WeChat user to an isolated, resumable Pi ACP conversation. */
export class WeChatRouter {
  private readonly active = new Map<string, ActiveTask>();
  private readonly userStates = new Map<string, UserState>();

  constructor(
    private readonly ilink: ILinkClient,
    private readonly adapter: CLIAdapter,
    private readonly getConfig: () => WeChatBridgeConfig,
    private readonly emit: (event: WeChatBridgeEvent) => void,
    private readonly sink: WeChatSessionSink,
  ) {}

  start(): void {
    for (const record of this.sink.allRecords()) {
      if (record.resumeId) this.getUserState(record.userId).resumeId = record.resumeId;
    }
    this.ilink.onMessage((message, text, refText) => {
      this.handle(message, text, refText).catch((err) => {
        const details = extractErrorDetails(err);
        log("WECHAT_ROUTER", { error: details, context: "route" });
      });
    });
  }

  async runFromDesktop(pccSessionId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const record = this.sink.getRecordBySessionId(pccSessionId);
    if (!record) return { ok: false, error: "找不到可继续的 Pi 微信会话" };
    if (this.active.has(record.userId)) return { ok: false, error: "Pi 正在运行中，请稍候" };
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "消息为空" };

    void this.exec(record.userId, trimmed, this.getConfig()).catch((err) => {
      const details = extractErrorDetails(err);
      log("WECHAT_ROUTER", { error: details, context: "desktop" });
    });
    return { ok: true };
  }

  cancelFromDesktop(pccSessionId: string): { ok: boolean; error?: string } {
    const record = this.sink.getRecordBySessionId(pccSessionId);
    if (!record) return { ok: false, error: "找不到可取消的 Pi 微信会话" };
    const task = this.active.get(record.userId);
    if (!task) return { ok: false, error: "当前没有正在运行的任务" };
    task.abort.abort();
    return { ok: true };
  }

  stop(): void {
    for (const task of this.active.values()) task.abort.abort();
    this.active.clear();
  }

  private getUserState(userId: string): UserState {
    let state = this.userStates.get(userId);
    if (!state) {
      state = {};
      this.userStates.set(userId, state);
    }
    return state;
  }

  private async handle(message: WeixinMessage, text: string, refText: string): Promise<void> {
    const userId = message.from_user_id;
    const config = this.getConfig();
    if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(userId)) {
      this.emit({ type: "activity", level: "warn", message: `拒绝未授权用户 ${userId.slice(0, 12)}…` });
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;
    this.emit({ type: "message", direction: "in", userId, tool: null, preview: trimmed.slice(0, 80) });

    if (trimmed.startsWith("/")) {
      await this.handleSlash(userId, trimmed, config);
      return;
    }

    let prompt = trimmed;
    const atMatch = trimmed.match(/^@(\w+)(?:[\s：:]\s*([\s\S]+))?$/);
    if (atMatch) {
      const alias = atMatch[1].toLowerCase();
      if (LEGACY_ALIASES.has(alias)) {
        await this.reply(userId, LEGACY_MIGRATION_MESSAGE);
        return;
      }
      if (alias !== "pi") {
        await this.reply(userId, `未知 Agent: @${atMatch[1]}（可用: @pi）`);
        return;
      }
      if (!atMatch[2]) {
        await this.reply(userId, "当前 Agent: Pi");
        return;
      }
      prompt = atMatch[2].trim();
    }

    if (this.active.has(userId)) {
      await this.reply(userId, "Pi 正在运行中，请稍候或发送 /cancel");
      return;
    }

    await this.exec(userId, [prompt, refText].filter(Boolean).join("\n\n"), config);
  }

  private async exec(userId: string, prompt: string, config: WeChatBridgeConfig): Promise<void> {
    const abort = new AbortController();
    const task: ActiveTask = { abort };
    this.active.set(userId, task);
    const state = this.getUserState(userId);
    let stopTyping: () => void = () => undefined;
    let pccSessionId = this.sink.getRecord(userId)?.pccSessionId;

    try {
      stopTyping = await this.ilink.startTyping(userId);
      pccSessionId = await this.sink.ensureSession(userId, prompt);
      task.pccSessionId = pccSessionId;

      const result = await this.adapter.execute(prompt, {
        workDir: config.workDir || os.homedir(),
        permissionMode: state.permissionMode ?? config.permissionMode,
        model: state.model ?? config.model,
        maxTurns: config.maxTurns,
        resumeId: state.resumeId,
        signal: abort.signal,
        onEvent: (event) => this.sink.forwardEvent(pccSessionId!, event),
      });

      let resetNotice = "";
      if (result.sessionExpired) {
        resetNotice = "[上个 Pi 会话已过期，已自动开始新会话]\n\n";
      }
      state.resumeId = result.resumeId;
      this.sink.updateResume(userId, result.resumeId);

      try {
        await this.sink.finalizeTurn(
          userId,
          result.resumeId,
          prompt,
          result.text,
          result.error,
        );
      } catch (err) {
        log("WECHAT_ROUTER", {
          error: extractErrorDetails(err),
          context: "persist",
          sessionId: pccSessionId,
        });
      } finally {
        this.sink.forwardTerminal(pccSessionId, result.terminal);
      }

      if (abort.signal.aborted) return;
      const footer = formatFooter(this.adapter.displayName, result.durationMs, result.error);
      await this.reply(userId, `${resetNotice}${result.text}\n\n${footer}`);
      this.emit({ type: "message", direction: "out", userId, tool: "pi", preview: result.text.slice(0, 80) });
    } catch (err) {
      if (abort.signal.aborted) return;
      const details = extractErrorDetails(err);
      log("WECHAT_ROUTER", { error: details, context: "execute", sessionId: pccSessionId });
      if (pccSessionId) {
        this.sink.forwardTerminal(pccSessionId, {
          kind: "transport_error",
          turnId: crypto.randomUUID(),
          error: {
            code: "pi_wechat_bridge_error",
            message: details.message,
            source: "harnss",
            stage: "prompt",
            retryable: true,
          },
        });
      }
      await this.reply(userId, `运行失败: ${details.message}`);
    } finally {
      stopTyping();
      this.active.delete(userId);
    }
  }

  private async handleSlash(userId: string, text: string, config: WeChatBridgeConfig): Promise<void> {
    const parts = text.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const state = this.getUserState(userId);

    switch (command) {
      case "help":
      case "h":
        await this.reply(
          userId,
          [
            "=== PccAgent 微信助手 ===",
            "直接发消息即可交给 Pi 处理，也可使用 @pi。",
            "",
            "【模型 / 模式】",
            "/model <名称>  切换 Pi 模型",
            "/mode <模式>   切换 auto / safe / plan",
            "",
            "【会话】",
            "/status /st  查看当前状态",
            "/new /n      开始新的 Pi 会话",
            "/clear       清除会话与偏好",
            "/cancel /c   取消当前运行",
            "/help /h     显示帮助",
          ].join("\n"),
        );
        return;

      case "pi":
        await this.reply(userId, "当前 Agent: Pi");
        return;

      case "claude":
      case "cc":
      case "codex":
      case "cx":
        await this.reply(userId, LEGACY_MIGRATION_MESSAGE);
        return;

      case "status":
      case "st": {
        const mode = state.permissionMode ?? config.permissionMode;
        await this.reply(
          userId,
          [
            "Agent: Pi",
            `模式: ${mode}`,
            `模型: ${state.model || config.model || "默认"}`,
            `目录: ${config.workDir || `${os.homedir()} (默认主目录)`}`,
            `会话: ${state.resumeId ? "进行中" : "新会话"}`,
          ].join("\n"),
        );
        return;
      }

      case "model":
      case "m": {
        const model = parts.slice(1).join(" ").trim();
        if (!model) {
          await this.reply(userId, `当前模型: ${state.model || config.model || "默认"}\n用法: /model <provider/model>`);
          return;
        }
        state.model = model;
        await this.reply(userId, `已切换 Pi 模型: ${model}`);
        return;
      }

      case "mode": {
        const mode = (parts[1] || "").toLowerCase();
        if (mode !== "auto" && mode !== "safe" && mode !== "plan") {
          await this.reply(
            userId,
            `当前模式: ${state.permissionMode ?? config.permissionMode}\n用法: /mode <auto|safe|plan>`,
          );
          return;
        }
        state.permissionMode = mode;
        await this.reply(userId, `已切换模式: ${mode}`);
        return;
      }

      case "new":
      case "n":
        delete state.resumeId;
        this.sink.updateResume(userId, undefined);
        await this.reply(userId, "已开始新的 Pi 会话");
        return;

      case "clear":
        delete state.resumeId;
        delete state.model;
        delete state.permissionMode;
        this.sink.updateResume(userId, undefined);
        await this.reply(userId, "已清除 Pi 会话与所有偏好");
        return;

      case "cancel":
      case "c":
      case "stop": {
        const task = this.active.get(userId);
        if (!task) {
          await this.reply(userId, "当前没有正在运行的任务");
          return;
        }
        task.abort.abort();
        await this.reply(userId, "已取消当前任务");
        return;
      }

      default:
        await this.reply(userId, `未知命令: /${command}\n发送 /help 查看可用命令`);
    }
  }

  private async reply(userId: string, text: string): Promise<void> {
    try {
      await this.ilink.sendText(userId, text);
    } catch (err) {
      log("WECHAT_ROUTER", { error: extractErrorDetails(err), context: "reply" });
    }
  }
}

function formatFooter(displayName: string, durationMs: number, error: boolean): string {
  const seconds = Math.round(durationMs / 1000);
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`;
  return `— ${displayName} · ${duration}${error ? " · 出错" : ""}`;
}
