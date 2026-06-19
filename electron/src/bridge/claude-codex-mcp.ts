/**
 * Dependency-light stdio MCP helper launched by the Claude Agent SDK.
 *
 * It speaks newline-delimited JSON-RPC 2.0 on stdin/stdout and exposes a single
 * `codex_delegate` tool. Tool calls are forwarded to the Harnss main-process
 * bridge controller over loopback HTTP; the bridge blocks until the visible
 * Codex split pane finishes the delegated turn, then returns the final text.
 *
 * Built by tsup to `electron/dist/claude-codex-mcp.js` and run via Electron with
 * `ELECTRON_RUN_AS_NODE=1`, so only Node built-ins / globals are available here.
 */
import http from "http";

const TOOL_NAME = "codex_delegate";
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface BridgeResponse {
  ok?: boolean;
  content?: string;
  error?: string;
}

function write(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id: string | number | null, result: Record<string, unknown>): void {
  write({ jsonrpc: "2.0", id, result });
}

function respondError(id: string | number | null, code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolResult(text: string, isError: boolean): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError };
}

/**
 * POST the delegation to the bridge using Node's raw http client. Unlike the
 * global fetch (undici), http.request has no default response/headers timeout,
 * so the request can stay open for the full duration of the delegated Codex
 * turn (which routinely exceeds undici's 5-minute headersTimeout). The bridge
 * controller enforces its own 30-minute cap.
 */
function postDelegate(
  endpoint: string,
  token: string,
  body: { prompt: string; cwd?: string },
): Promise<{ status: number; data: BridgeResponse }> {
  return new Promise((resolve, reject) => {
    const target = new URL(`${endpoint}/delegate`);
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: raw ? (JSON.parse(raw) as BridgeResponse) : {} });
          } catch (err) {
            reject(err instanceof Error ? err : new Error("Invalid bridge response"));
          }
        });
      },
    );
    req.on("error", reject);
    // No socket timeout — the bridge holds the response until Codex finishes.
    req.setTimeout(0);
    req.write(payload);
    req.end();
  });
}

async function delegateToBridge(prompt: string, cwd: string | undefined): Promise<Record<string, unknown>> {
  const url = process.env.HARNSS_CODEX_BRIDGE_URL;
  const token = process.env.HARNSS_CODEX_BRIDGE_TOKEN;
  if (url === undefined || token === undefined) {
    return toolResult("Codex bridge is not configured (missing endpoint or token).", true);
  }

  try {
    const { status, data } = await postDelegate(url, token, { prompt, cwd });
    if (status >= 200 && status < 300 && data.ok === true) {
      return toolResult(data.content ?? "", false);
    }
    return toolResult(data.error ?? `Codex delegation failed (HTTP ${status}).`, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolResult(`Codex delegation request failed: ${message}`, true);
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const id = request.id ?? null;
  switch (request.method) {
    case "initialize": {
      const requested = request.params?.protocolVersion;
      respond(id, {
        protocolVersion: typeof requested === "string" ? requested : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "harnss-codex", version: "1.0.0" },
      });
      return;
    }
    case "notifications/initialized":
    case "initialized":
      // Notification — no response.
      return;
    case "tools/list": {
      respond(id, {
        tools: [
          {
            name: TOOL_NAME,
            description:
              "Delegate a coding task to Codex. Opens a visible Codex split pane in Harnss, runs the task, and returns Codex's final result. Use for work better suited to Codex.",
            inputSchema: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  description: "The full task description to delegate to Codex.",
                },
                cwd: {
                  type: "string",
                  description: "Optional working directory for the Codex session.",
                },
              },
              required: ["prompt"],
            },
          },
        ],
      });
      return;
    }
    case "tools/call": {
      const params = request.params ?? {};
      const name = params.name;
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (name !== TOOL_NAME) {
        respondError(id, -32602, `Unknown tool: ${String(name)}`);
        return;
      }
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (prompt.trim().length === 0) {
        respond(id, toolResult("Missing required `prompt` argument.", true));
        return;
      }
      const cwd = typeof args.cwd === "string" ? args.cwd : undefined;
      respond(id, await delegateToBridge(prompt, cwd));
      return;
    }
    default: {
      if (id === null) return; // Unknown notification — ignore.
      respondError(id, -32601, `Method not found: ${request.method}`);
    }
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line.length > 0) {
      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        void handleRequest(request);
      } catch {
        // Ignore malformed lines — the SDK client controls framing.
      }
    }
    newlineIndex = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => {
  process.exit(0);
});
