import type { WeChatPermissionMode, WeChatTool } from "@shared/types/wechat";
import type { ACPErrorDetails, ACPPiTurnOutcome } from "@shared/types/acp";

export interface AdapterStreamEvent {
  sessionId: string;
  update: unknown;
}

export type AdapterTerminal =
  | { kind: "outcome"; outcome: ACPPiTurnOutcome }
  | { kind: "transport_error"; turnId: string; error: ACPErrorDetails };

/** Options passed to a one-shot CLI run triggered by an inbound WeChat message. */
export interface AdapterExecOptions {
  /** Directory the CLI runs in. */
  workDir: string;
  /** Permission / sandbox posture. */
  permissionMode: WeChatPermissionMode;
  /** Model override (empty = engine default). */
  model: string;
  /** Compatibility cap retained in the persisted WeChat configuration. */
  maxTurns: number;
  /** Engine-specific resume id from the user's previous run (continues context). */
  resumeId?: string;
  /** Aborts the run (e.g. /cancel or shutdown). */
  signal: AbortSignal;
  /** Streamed intermediate text for progressive WeChat replies (optional). */
  onIntermediate?: (chunk: string) => void;
  /**
   * ACP update passthrough so the renderer can render this turn live under
   * the stable PccAgent session ID owned by the WeChat session sink.
   */
  onEvent?: (event: AdapterStreamEvent) => void;
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
  /** Exactly one terminal signal for renderer/background cleanup. */
  terminal: AdapterTerminal;
}

/** A built-in CLI engine the bridge can drive. */
export interface CLIAdapter {
  readonly name: WeChatTool;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  execute(prompt: string, opts: AdapterExecOptions): Promise<AdapterExecResult>;
}
