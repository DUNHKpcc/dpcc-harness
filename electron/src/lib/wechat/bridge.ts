import os from "node:os";
import type { BrowserWindow } from "electron";
import { log } from "../logger";
import { reportError } from "../error-utils";
import { readProjects, ensureProjectForPath, markWechatProject } from "../projects-store";
import { ILinkClient } from "./ilink-client";
import { WeChatRouter } from "./router";
import { WeChatSessionSink } from "./session-sink";
import { login, isLoginCancelled } from "./auth";
import { resetClaudeBinaryCache } from "../claude-binary";
import { ClaudeAdapter } from "./adapters/claude-adapter";
import { CodexAdapter } from "./adapters/codex-adapter";
import {
  loadWeChatConfig,
  saveWeChatConfig,
  loadWeChatCredentials,
  saveWeChatCredentials,
  clearWeChatCredentials,
  clearWeChatRuntimeState,
  ilinkPersistence,
} from "./store";
import type { CLIAdapter } from "./adapters/types";
import type { Credentials } from "./types";
import type {
  WeChatBridgeConfig,
  WeChatBridgeEvent,
  WeChatBridgeState,
  WeChatConnectionStatus,
  WeChatTool,
} from "@shared/types/wechat";

type EventListener = (event: WeChatBridgeEvent) => void;

/**
 * Singleton orchestrator for the WeChat bridge. Owns the QR login flow, the
 * long-poll client, the message router, and the bridge's connection lifecycle.
 * Pushes state + activity to the renderer via `onEvent` listeners.
 */
export class WeChatBridge {
  private config: WeChatBridgeConfig;
  private credentials: Credentials | null;
  private client: ILinkClient | null = null;
  private router: WeChatRouter | null = null;
  private status: WeChatConnectionStatus = "disconnected";
  private error: string | null = null;
  private loginAbort: AbortController | null = null;
  private readonly listeners = new Set<EventListener>();
  private readonly adapters: Record<WeChatTool, CLIAdapter>;
  private readonly sink: WeChatSessionSink;
  private getMainWindow: () => BrowserWindow | null = () => null;
  private credentialsLoaded = false;

  constructor() {
    this.config = loadWeChatConfig();
    // Credentials are read lazily (see ensureInit), NOT here: the bridge is
    // constructed during IPC registration, which runs before app `ready`. On
    // Windows safeStorage (DPAPI) only decrypts after `ready`, so reading the
    // encrypted credential file now would yield null and silently log the user
    // out on every restart (B3).
    this.credentials = null;
    this.adapters = { claude: new ClaudeAdapter(), codex: new CodexAdapter() };
    this.sink = new WeChatSessionSink({
      getMainWindow: () => this.getMainWindow(),
      getConfig: () => this.config,
      emit: (event) => this.emit(event),
    });
  }

  /** Supply the live BrowserWindow getter so the sink can stream events to the UI. */
  attachWindow(getMainWindow: () => BrowserWindow | null): void {
    this.getMainWindow = getMainWindow;
  }

  /**
   * Load persisted credentials. Deferred out of the constructor so it runs after
   * app `ready` (when safeStorage can decrypt). Idempotent; safe to call from
   * any post-ready reader. The first such call recovers the stored login.
   */
  private ensureInit(): void {
    if (this.credentialsLoaded) return;
    this.credentialsLoaded = true;
    this.credentials = loadWeChatCredentials();
  }

  // ─── Events / state ──────────────────────────────────────

  onEvent(cb: EventListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: WeChatBridgeEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch (err) {
        log("WECHAT_BRIDGE", `事件监听器异常: ${(err as Error).message}`);
      }
    }
  }

  private isRunning(): boolean {
    return this.client?.isRunning() ?? false;
  }

  getState(): WeChatBridgeState {
    this.ensureInit();
    return {
      status: this.status,
      running: this.isRunning(),
      hasCredentials: !!this.credentials,
      botUserId: this.credentials?.ilinkUserId ?? null,
      config: this.config,
      error: this.error,
    };
  }

  private setStatus(status: WeChatConnectionStatus): void {
    this.status = status;
    this.emit({ type: "state", state: this.getState() });
  }

  // ─── Config ──────────────────────────────────────────────

  setConfig(patch: Partial<WeChatBridgeConfig>): WeChatBridgeState {
    this.ensureInit();
    const wasEnabled = this.config.enabled;
    this.config = saveWeChatConfig({ ...this.config, ...patch });

    // The `enabled` flag doubles as the live on/off switch.
    if (this.config.enabled && !wasEnabled && this.credentials && !this.isRunning()) {
      this.start();
    } else if (!this.config.enabled && wasEnabled && this.isRunning()) {
      this.stop();
    }

    this.emit({ type: "state", state: this.getState() });
    return this.getState();
  }

  // ─── Login ───────────────────────────────────────────────

  async login(): Promise<{ ok: boolean; error?: string }> {
    this.ensureInit();
    if (this.loginAbort) return { ok: false, error: "登录已在进行中" };
    this.loginAbort = new AbortController();
    this.setStatus("connecting");

    try {
      const creds = await login(
        {
          onQRCode: (content) => this.emit({ type: "qrcode", content }),
          onStatus: (status) => this.emit({ type: "login-status", status }),
        },
        this.loginAbort.signal,
      );
      this.credentials = creds;
      saveWeChatCredentials(creds);
      this.error = null;
      this.emit({ type: "login-success" });

      // Logging in implies the user wants the bridge on now and on next launch.
      this.config = saveWeChatConfig({ ...this.config, enabled: true });
      this.start();
      return { ok: true };
    } catch (err) {
      if (isLoginCancelled(err)) {
        this.setStatus(this.isRunning() ? "connected" : "disconnected");
        this.emit({ type: "login-error", message: "已取消", cancelled: true });
        return { ok: false, error: "已取消" };
      }
      const msg = reportError("WECHAT_LOGIN", err);
      this.error = msg;
      this.setStatus("error");
      this.emit({ type: "login-error", message: msg });
      return { ok: false, error: msg };
    } finally {
      this.loginAbort = null;
    }
  }

  cancelLogin(): void {
    this.loginAbort?.abort();
  }

  async logout(): Promise<WeChatBridgeState> {
    this.ensureInit();
    this.cancelLogin();
    this.stop();
    clearWeChatCredentials();
    clearWeChatRuntimeState();
    this.sink.clear();
    this.credentials = null;
    this.config = saveWeChatConfig({ ...this.config, enabled: false });
    this.setStatus("disconnected");
    return this.getState();
  }

  // ─── Connection lifecycle ────────────────────────────────

  start(): { ok: boolean; error?: string } {
    this.ensureInit();
    if (!this.credentials) return { ok: false, error: "未登录微信" };
    if (this.isRunning()) return { ok: true };

    this.error = null;
    this.ensureProject();
    const client = new ILinkClient(this.credentials, ilinkPersistence);
    client.setReloginHandler(() => this.reloginForSelfHeal());

    this.router = new WeChatRouter(
      client,
      this.adapters,
      () => this.config,
      (event) => this.emit(event),
      this.sink,
    );
    this.router.start();
    client.start();
    this.client = client;

    this.setStatus("connected");
    this.emit({ type: "activity", level: "info", message: "微信桥接已启动" });
    return { ok: true };
  }

  stop(): void {
    // Cancel any in-flight login (manual OR self-heal) — a stopped bridge must
    // not keep polling WeChat for a QR scan or resurrect credentials afterwards.
    this.loginAbort?.abort();
    this.router?.stop();
    this.client?.stop();
    this.router = null;
    this.client = null;
    if (this.status !== "error") this.setStatus("disconnected");
    this.emit({ type: "activity", level: "info", message: "微信桥接已停止" });
  }

  /**
   * Tear down and re-establish the live connection WITHOUT dropping credentials.
   * Manual recovery for when the long-poll went stale or the user changed the
   * engine / gateway / CLI-binary config and wants the running bridge to pick it
   * up — far less disruptive than a full QR re-scan (B4). Also clears the resolved
   * Claude binary cache so a just-fixed path/source takes effect immediately.
   */
  reconnect(): { ok: boolean; error?: string } {
    this.ensureInit();
    if (!this.credentials) return { ok: false, error: "未登录微信，无法重新连接" };

    log("WECHAT_BRIDGE", "reconnect: re-establishing the live connection");
    resetClaudeBinaryCache();

    // Drop the current client/router; keep credentials + config untouched.
    this.router?.stop();
    this.client?.stop();
    this.router = null;
    this.client = null;

    const result = this.start();
    if (result.ok) {
      this.emit({ type: "activity", level: "info", message: "微信桥接已重新连接" });
    }
    return result;
  }

  /**
   * Bind the bridge to a single PccAgent project so its conversations land in the
   * sidebar's WeChat area. Reuses the configured project if still valid, otherwise
   * creates/reuses one for the working directory and persists the id.
   */
  private ensureProject(): void {
    const ICON = { icon: "Smartphone", iconType: "lucide" } as const;
    try {
      const projects = readProjects();
      const bound = this.config.projectId
        ? projects.find((p) => p.id === this.config.projectId)
        : undefined;
      if (bound) {
        // Heal the auto-created dedicated project so the sidebar hides the empty
        // duplicate. A user-chosen project (different name) is left untouched.
        if (bound.name === "微信") markWechatProject(bound.id, ICON.icon, ICON.iconType);
        return;
      }
      const dir = this.config.workDir || os.homedir();
      const project = ensureProjectForPath(dir, "微信", { ...ICON, wechat: true });
      this.config = saveWeChatConfig({ ...this.config, projectId: project.id });
      this.emit({ type: "state", state: this.getState() });
    } catch (err) {
      reportError("WECHAT_ENSURE_PROJECT", err);
    }
  }

  /** Continue a WeChat conversation from the desktop (relays the reply back to WeChat). */
  async sendFromDesktop(opts: { sessionId: string; text: string }): Promise<{ ok: boolean; error?: string }> {
    if (!this.router) return { ok: false, error: "微信桥接未运行，无法续聊" };
    return this.router.runFromDesktop(opts.sessionId, opts.text);
  }

  /** Auto-start at app launch when enabled and already logged in. */
  autoStart(): void {
    this.ensureInit();
    if (this.config.enabled && this.credentials) {
      log("WECHAT_BRIDGE", "auto-start: enabled + credentials present");
      this.start();
    }
  }

  /** Re-run QR login when the iLink session expires; persist + return new creds. */
  private async reloginForSelfHeal(): Promise<Credentials | null> {
    // Share the single-flight login guard so a self-heal can't race a manual login,
    // and so stop()/logout()/cancelLogin() can abort this otherwise-detached flow.
    if (this.loginAbort) return null;
    this.loginAbort = new AbortController();
    try {
      const creds = await login(
        {
          onQRCode: (content) => this.emit({ type: "qrcode", content }),
          onStatus: (status) => this.emit({ type: "login-status", status }),
        },
        this.loginAbort.signal,
      );
      // The bridge may have been stopped/logged-out while the QR scan was pending —
      // don't resurrect credentials the user just cleared.
      if (this.loginAbort.signal.aborted) return null;
      this.credentials = creds;
      saveWeChatCredentials(creds);
      this.emit({ type: "login-success" });
      return creds;
    } catch (err) {
      if (isLoginCancelled(err)) return null;
      reportError("WECHAT_RELOGIN", err);
      return null;
    } finally {
      this.loginAbort = null;
    }
  }
}

let singleton: WeChatBridge | null = null;

/** Lazily-constructed process-wide bridge instance. */
export function getWeChatBridge(): WeChatBridge {
  if (!singleton) singleton = new WeChatBridge();
  return singleton;
}
