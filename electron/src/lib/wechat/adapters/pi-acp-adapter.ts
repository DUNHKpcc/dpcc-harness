import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type {
  ClientSideConnection,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { BUILTIN_PI_AGENT } from "@shared/types/registry";
import { ACP_CLIENT_CAPABILITIES, applyReadRange, resolveACPFilePath } from "@shared/lib/acp-helpers";
import {
  classifyAcpTurn,
  createAcpTurnObservation,
  observeAcpTurnUpdate,
  toAcpPiTurnOutcome,
} from "@shared/lib/acp-turn";
import type { ACPErrorDetails, ACPErrorStage } from "@shared/types/acp";
import { extractErrorDetails } from "../../error-utils";
import { log } from "../../logger";
import { preparePiAcpLaunch, type PiAcpLaunchDefinition } from "../../pi-acp-config";
import { killProcessTree } from "../../process-tree";
import type { AdapterExecOptions, AdapterExecResult, CLIAdapter } from "./types";

let acpModule: typeof import("@agentclientprotocol/sdk") | null = null;

async function getACP(): Promise<typeof import("@agentclientprotocol/sdk")> {
  if (!acpModule) acpModule = await import("@agentclientprotocol/sdk");
  return acpModule;
}

const INIT_TIMEOUT_MS = 15_000;
const SESSION_TIMEOUT_MS = 20_000;
const TURN_TIMEOUT_MS = 10 * 60_000;
const MAX_STDERR_TAIL = 4_000;
const READ_ONLY_TOOL_KINDS = new Set(["read", "search", "think", "fetch"]);
const SESSION_ERROR_RE =
  /unknown sessionid|session.*not.*(found|exist)|invalid.*session|session.*(invalid|expired)|cannot.*resume|resume.*(fail|not.*found)/i;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function withChildFailure<T>(operation: Promise<T>, childFailure: Promise<Error>): Promise<T> {
  return Promise.race([
    operation,
    childFailure.then((error) => Promise.reject(error)),
  ]);
}

function shouldUseShell(binary: string): boolean {
  if (process.platform !== "win32") return false;
  const normalized = binary.trim().replace(/^["']|["']$/g, "");
  const ext = path.extname(normalized).toLowerCase();
  if (ext === ".exe" || ext === ".com") return false;
  if (ext === ".cmd" || ext === ".bat") return true;
  return !/[\\/]/.test(normalized);
}

function sanitizeStderr(value: string): string {
  const normalized = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  return extractErrorDetails(normalized).message;
}

function appendTail(previous: string, next: string): string {
  const combined = previous ? `${previous}\n${next}` : next;
  return combined.length > MAX_STDERR_TAIL ? combined.slice(-MAX_STDERR_TAIL) : combined;
}

function errorDetails(
  err: unknown,
  code: string,
  stage: ACPErrorStage,
  retryable: boolean,
): ACPErrorDetails {
  const extracted = extractErrorDetails(err);
  return {
    code,
    message: extracted.message,
    source: "pi",
    stage,
    retryable,
    ...(extracted.cause ? { cause: extracted.cause } : {}),
  };
}

function cancelledResult(
  startedAt: number,
  turnId: string,
  resumeId?: string,
): AdapterExecResult {
  const outcome = toAcpPiTurnOutcome(
    { status: "cancelled", stopReason: "cancelled" },
    turnId,
  );
  return {
    text: "已取消",
    ...(resumeId ? { resumeId } : {}),
    error: true,
    durationMs: Date.now() - startedAt,
    terminal: { kind: "outcome", outcome },
  };
}

function transportFailure(
  startedAt: number,
  turnId: string,
  err: unknown,
  code: string,
  stage: ACPErrorStage,
  retryable = true,
  resumeId?: string,
): AdapterExecResult {
  const error = errorDetails(err, code, stage, retryable);
  return {
    text: `运行失败: ${error.message}`,
    ...(resumeId ? { resumeId } : {}),
    error: true,
    durationMs: Date.now() - startedAt,
    terminal: { kind: "transport_error", turnId, error },
  };
}

function pickPermissionOption(
  params: RequestPermissionRequest,
  mode: AdapterExecOptions["permissionMode"],
): PermissionOption | undefined {
  const canRead = READ_ONLY_TOOL_KINDS.has(params.toolCall.kind ?? "other");
  const allow = mode === "auto" || canRead;
  const preferredKinds = allow
    ? (["allow_once", "allow_always"] as const)
    : (["reject_once", "reject_always"] as const);
  return preferredKinds
    .map((kind) => params.options.find((option) => option.kind === kind))
    .find((option): option is PermissionOption => option != null);
}

async function applyModel(
  connection: ClientSideConnection,
  sessionId: string,
  model: string,
): Promise<void> {
  const value = model.trim();
  if (!value) return;
  await connection.setSessionConfigOption({ sessionId, configId: "model", value });
}

/** One-shot, resumable Pi ACP runtime used by phone and desktop WeChat turns. */
export class PiAcpAdapter implements CLIAdapter {
  readonly name = "pi" as const;
  readonly displayName = "Pi";

  async isAvailable(): Promise<boolean> {
    let launch: PiAcpLaunchDefinition | undefined;
    try {
      launch = await preparePiAcpLaunch(BUILTIN_PI_AGENT);
      return true;
    } catch {
      return false;
    } finally {
      launch?.cleanup?.();
    }
  }

  async execute(prompt: string, opts: AdapterExecOptions): Promise<AdapterExecResult> {
    const startedAt = Date.now();
    const turnId = crypto.randomUUID();
    if (opts.signal.aborted) return cancelledResult(startedAt, turnId, opts.resumeId);

    let launch: PiAcpLaunchDefinition;
    try {
      launch = await preparePiAcpLaunch(BUILTIN_PI_AGENT);
    } catch (err) {
      return transportFailure(
        startedAt,
        turnId,
        err,
        "pi_wechat_runtime_unavailable",
        "spawn",
        false,
        opts.resumeId,
      );
    }

    let proc: ChildProcess | null = null;
    let connection: ClientSideConnection | null = null;
    let acpSessionId: string | undefined;
    let loading = false;
    let turnStarted = false;
    let assistantText = "";
    let stderrTail = "";
    let stderrError: string | undefined;
    let resumedWithFreshSession = false;
    const observation = createAcpTurnObservation();

    const onAbort = () => {
      if (connection && acpSessionId) {
        void connection.cancel({ sessionId: acpSessionId }).catch(() => undefined);
      }
      killProcessTree(proc);
    };
    opts.signal.addEventListener("abort", onAbort, { once: true });

    try {
      const acp = await getACP();
      proc = spawn(launch.binary, launch.args ?? [], {
        cwd: opts.workDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: launch.replaceEnvironment ? launch.env : { ...process.env, ...launch.env },
        shell: shouldUseShell(launch.binary),
        windowsHide: true,
      });

      let resolveChildFailure!: (error: Error) => void;
      let childFailureRecorded = false;
      const childFailure = new Promise<Error>((resolve) => {
        resolveChildFailure = resolve;
      });
      const recordChildFailure = (error: Error) => {
        if (childFailureRecorded) return;
        childFailureRecorded = true;
        resolveChildFailure(error);
      };
      proc.once("error", (error) => {
        recordChildFailure(Object.assign(
          new Error(`Pi ACP child could not be started: ${extractErrorDetails(error).message}`),
          { code: "pi_wechat_child_error" },
        ));
      });
      proc.once("exit", (code, signal) => {
        recordChildFailure(Object.assign(
          new Error(`Pi ACP child exited before the request settled (code=${code ?? "null"}, signal=${signal ?? "null"}).`),
          { code: "pi_wechat_child_exit" },
        ));
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const cleaned = sanitizeStderr(chunk.toString());
        if (!cleaned) return;
        stderrTail = appendTail(stderrTail, cleaned);
        if (/unhandled error during turn|\berror\b|\bfailed\b|\btimeout\b|unauthori[sz]ed|\bconnection\b/i.test(cleaned)) {
          stderrError = cleaned;
        }
        log("WECHAT_PI_STDERR", { tail: cleaned });
      });

      const input = Writable.toWeb(proc.stdin!) as WritableStream;
      const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
      const stream = acp.ndJsonStream(input, output);

      connection = new acp.ClientSideConnection((_agent) => ({
        async sessionUpdate(params: SessionNotification) {
          if (loading || !acpSessionId || params.sessionId !== acpSessionId) return;
          const observed = turnStarted
            ? observeAcpTurnUpdate(observation, params.update, {
                isPi: true,
                adapterVersion: launch.adapterVersion,
              })
            : { diagnostic: false };
          if (observed.diagnostic) return;

          if (turnStarted && params.update.sessionUpdate === "agent_message_chunk") {
            const text = params.update.content.type === "text" ? params.update.content.text : undefined;
            if (text) {
              assistantText += text;
              opts.onIntermediate?.(text);
            }
          }
          opts.onEvent?.({ sessionId: params.sessionId, update: params.update });
        },
        async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
          const selected = pickPermissionOption(params, opts.permissionMode);
          return selected
            ? { outcome: { outcome: "selected", optionId: selected.optionId } }
            : { outcome: { outcome: "cancelled" } };
        },
        async readTextFile(params: { path?: string; uri?: string; line?: number | null; limit?: number | null }) {
          const filePath = resolveACPFilePath(params);
          const content = await fs.readFile(filePath, "utf-8");
          return { content: applyReadRange(content, params.line, params.limit) };
        },
        async writeTextFile(params: { path?: string; uri?: string; content: string }) {
          if (opts.permissionMode !== "auto") {
            throw new Error("WeChat safe/plan mode does not allow file writes.");
          }
          const filePath = resolveACPFilePath(params);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, params.content, "utf-8");
          return {};
        },
      }), stream);

      const initialized = await withTimeout(
        withChildFailure(
          connection.initialize({
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: ACP_CLIENT_CAPABILITIES,
          }),
          childFailure,
        ),
        INIT_TIMEOUT_MS,
        "Pi ACP initialize",
      );

      if (initialized.agentCapabilities?.loadSession === true && opts.resumeId) {
        loading = true;
        try {
          await withTimeout(
            withChildFailure(
              connection.loadSession({ sessionId: opts.resumeId, cwd: opts.workDir, mcpServers: [] }),
              childFailure,
            ),
            SESSION_TIMEOUT_MS,
            "Pi ACP session/load",
          );
          acpSessionId = opts.resumeId;
        } catch (err) {
          if (!SESSION_ERROR_RE.test(extractErrorDetails(err).message)) throw err;
          const created = await withTimeout(
            withChildFailure(
              connection.newSession({ cwd: opts.workDir, mcpServers: [] }),
              childFailure,
            ),
            SESSION_TIMEOUT_MS,
            "Pi ACP session/new",
          );
          acpSessionId = created.sessionId;
          resumedWithFreshSession = true;
        } finally {
          loading = false;
        }
      } else {
        const created = await withTimeout(
          withChildFailure(
            connection.newSession({ cwd: opts.workDir, mcpServers: [] }),
            childFailure,
          ),
          SESSION_TIMEOUT_MS,
          "Pi ACP session/new",
        );
        acpSessionId = created.sessionId;
        resumedWithFreshSession = !!opts.resumeId;
      }

      await withChildFailure(applyModel(connection, acpSessionId, opts.model), childFailure);
      if (opts.signal.aborted) return cancelledResult(startedAt, turnId, acpSessionId ?? opts.resumeId);

      turnStarted = true;
      const response = await withTimeout(
        withChildFailure(
          connection.prompt({
            sessionId: acpSessionId,
            prompt: [{ type: "text", text: prompt }],
          }),
          childFailure,
        ),
        TURN_TIMEOUT_MS,
        "Pi ACP prompt",
      );
      turnStarted = false;

      if (opts.signal.aborted) return cancelledResult(startedAt, turnId, acpSessionId ?? opts.resumeId);

      const classified = classifyAcpTurn({
        stopReason: response.stopReason,
        isPi: true,
        adapterVersion: launch.adapterVersion,
        observation,
        stderrError,
      });
      const outcome = toAcpPiTurnOutcome(classified, turnId);
      const text = outcome.status === "failed"
        ? `运行失败: ${outcome.error.message}`
        : assistantText.trim() || "(无输出)";

      return {
        text,
        resumeId: acpSessionId,
        error: outcome.status !== "completed",
        durationMs: Date.now() - startedAt,
        sessionExpired: resumedWithFreshSession || undefined,
        terminal: { kind: "outcome", outcome },
      };
    } catch (err) {
      if (opts.signal.aborted) return cancelledResult(startedAt, turnId, acpSessionId ?? opts.resumeId);
      const extracted = extractErrorDetails(err);
      const message = stderrError || stderrTail || extracted.message;
      const stage: ACPErrorStage = proc == null ? "spawn" : acpSessionId ? "prompt" : "initialize";
      const code = extracted.code === "pi_wechat_child_exit" || extracted.code === "pi_wechat_child_error"
        ? extracted.code
        : "pi_wechat_transport_error";
      return transportFailure(
        startedAt,
        turnId,
        message,
        String(code),
        stage,
        true,
        acpSessionId ?? opts.resumeId,
      );
    } finally {
      opts.signal.removeEventListener("abort", onAbort);
      killProcessTree(proc);
      launch.cleanup?.();
    }
  }
}
