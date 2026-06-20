import type { WeChatPermissionMode, WeChatTool } from "@shared/types/wechat";

/** Options passed to a one-shot CLI run triggered by an inbound WeChat message. */
export interface AdapterExecOptions {
  /** Directory the CLI runs in. */
  workDir: string;
  /** Permission / sandbox posture. */
  permissionMode: WeChatPermissionMode;
  /** Model override (empty = engine default). */
  model: string;
  /** Max agent turns (Claude only). */
  maxTurns: number;
  /** Engine-specific resume id from the user's previous run (continues context). */
  resumeId?: string;
  /** Aborts the run (e.g. /cancel or shutdown). */
  signal: AbortSignal;
  /** Streamed intermediate text for progressive WeChat replies (optional). */
  onIntermediate?: (chunk: string) => void;
  /**
   * Raw engine event passthrough (optional). For Claude these are the SDK
   * `query()` messages verbatim, so the renderer's existing `claude:event`
   * pipeline can render WeChat runs live when tagged with a `_sessionId`.
   */
  onEvent?: (raw: unknown) => void;
}

/** Result of a one-shot CLI run. */
export interface AdapterExecResult {
  /** Final assistant text to send back to WeChat. */
  text: string;
  /** Engine session id to persist for the next message's resume. */
  resumeId?: string;
  /** True when the run failed or was reported as an error result. */
  error: boolean;
  /** Wall-clock duration. */
  durationMs: number;
  /** True when the failure looks like an expired/invalid resume session. */
  sessionExpired?: boolean;
}

/** A built-in CLI engine the bridge can drive. */
export interface CLIAdapter {
  readonly name: WeChatTool;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  execute(prompt: string, opts: AdapterExecOptions): Promise<AdapterExecResult>;
}
