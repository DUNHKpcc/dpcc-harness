/**
 * Loopback bridge controller for Claude → Codex delegation.
 *
 * The stdio MCP helper (`claude-codex-mcp.ts`) launched inside the Claude SDK
 * process forwards `codex_delegate` tool calls to this controller over a local
 * HTTP endpoint. The controller notifies the renderer, which opens a visible
 * Codex split pane, runs the delegated turn, and reports back via
 * `completeDelegation`. The HTTP response is only written once the renderer
 * resolves the delegation, so the MCP tool call blocks until Codex finishes.
 */
import http from "http";
import crypto from "crypto";
import { log } from "./logger";
import { reportError } from "./error-utils";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const DELEGATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface ClaudeCodexDelegationRequest {
  id: string;
  prompt: string;
  cwd?: string;
  claudeSessionId?: string;
}

export interface ClaudeCodexDelegationResult {
  id: string;
  ok: boolean;
  content: string;
  codexSessionId?: string;
  error?: string;
}

export interface ClaudeCodexBridgeControllerOptions {
  notifyRenderer: (request: ClaudeCodexDelegationRequest) => void;
}

export interface ClaudeCodexBridgeController {
  endpoint: string;
  token: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  completeDelegation: (result: ClaudeCodexDelegationResult) => void;
}

interface PendingDelegation {
  resolve: (result: ClaudeCodexDelegationResult) => void;
  timeout: NodeJS.Timeout;
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body exceeds 1 MB limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function createClaudeCodexBridgeController(
  options: ClaudeCodexBridgeControllerOptions,
): ClaudeCodexBridgeController {
  const token = crypto.randomUUID();
  const pending = new Map<string, PendingDelegation>();
  let server: http.Server | null = null;
  let endpoint = "";

  function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(payload);
  }

  async function handleDelegate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${token}`) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: reportError("CLAUDE_CODEX_BRIDGE_BODY", err) });
      return;
    }

    const data = (body ?? {}) as Record<string, unknown>;
    const prompt = typeof data.prompt === "string" ? data.prompt : "";
    if (prompt.trim().length === 0) {
      sendJson(res, 400, { ok: false, error: "Missing required `prompt` field" });
      return;
    }

    const request: ClaudeCodexDelegationRequest = {
      id: `delegation-${crypto.randomUUID()}`,
      prompt,
      cwd: typeof data.cwd === "string" ? data.cwd : undefined,
      claudeSessionId: typeof data.claudeSessionId === "string" ? data.claudeSessionId : undefined,
    };

    const result = await new Promise<ClaudeCodexDelegationResult>((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(request.id);
        resolve({
          id: request.id,
          ok: false,
          content: "",
          error: "Codex delegation timed out after 30 minutes.",
        });
      }, DELEGATION_TIMEOUT_MS);
      pending.set(request.id, { resolve, timeout });
      try {
        options.notifyRenderer(request);
      } catch (err) {
        clearTimeout(timeout);
        pending.delete(request.id);
        resolve({
          id: request.id,
          ok: false,
          content: "",
          error: reportError("CLAUDE_CODEX_BRIDGE_NOTIFY", err),
        });
      }
    });

    const status = result.error && result.ok === false && result.content === "" ? 504 : 200;
    sendJson(res, result.ok ? 200 : status, result);
  }

  function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/delegate") {
          void handleDelegate(req, res);
          return;
        }
        sendJson(res, 404, { ok: false, error: "Not found" });
      });
      httpServer.on("error", reject);
      httpServer.listen(0, "127.0.0.1", () => {
        const address = httpServer.address();
        if (address === null || typeof address === "string") {
          reject(new Error("Failed to resolve bridge controller port"));
          return;
        }
        server = httpServer;
        endpoint = `http://127.0.0.1:${address.port}`;
        log("CLAUDE_CODEX_BRIDGE", `Listening on ${endpoint}`);
        resolve();
      });
    });
  }

  function stop(): Promise<void> {
    for (const [, entry] of pending) {
      clearTimeout(entry.timeout);
      entry.resolve({ id: "", ok: false, content: "", error: "Bridge controller stopped." });
    }
    pending.clear();
    const active = server;
    server = null;
    if (active === null) return Promise.resolve();
    return new Promise((resolve) => {
      active.close(() => resolve());
    });
  }

  function completeDelegation(result: ClaudeCodexDelegationResult): void {
    const entry = pending.get(result.id);
    if (entry === undefined) {
      log("CLAUDE_CODEX_BRIDGE", `No pending delegation for ${result.id}`);
      return;
    }
    clearTimeout(entry.timeout);
    pending.delete(result.id);
    entry.resolve(result);
  }

  return {
    get endpoint() {
      return endpoint;
    },
    token,
    start,
    stop,
    completeDelegation,
  };
}

/**
 * Process-wide singleton accessor. `main.ts` owns the lifecycle (create →
 * start → stop); `claude-sessions.ts` reads the running instance to inject the
 * bridge MCP server config into Claude sessions.
 */
let activeController: ClaudeCodexBridgeController | null = null;

export function setClaudeCodexBridgeController(controller: ClaudeCodexBridgeController | null): void {
  activeController = controller;
}

export function getClaudeCodexBridgeController(): ClaudeCodexBridgeController | null {
  return activeController;
}
