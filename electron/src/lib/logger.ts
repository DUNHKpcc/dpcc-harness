import path from "path";
import fs from "fs";
import { app } from "electron";

const logsDir = app.isPackaged
  ? path.join(app.getPath("userData"), "logs")
  : path.join(__dirname, "..", "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });

// --- Retention ---
// One log file is created per launch (main-<timestamp>.log). Without cleanup
// these accumulate forever in the user's profile (%APPDATA% on Windows,
// ~/Library/Application Support on macOS). On startup we prune: keep only the
// most recent MAX_LOG_FILES and drop anything older than MAX_LOG_AGE_MS.
const MAX_LOG_FILES = 10;
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOG_FILE_RE = /^main-\d+\.log$/;

// Per-line cap: a single tool_result / result payload (full file reads, command
// output) can be hundreds of KB. Truncate so one event can't balloon the file.
const MAX_LOG_LINE_CHARS = 20_000;

function pruneOldLogs(): void {
  try {
    const now = Date.now();
    const entries = fs
      .readdirSync(logsDir)
      .filter((name) => LOG_FILE_RE.test(name))
      .map((name) => {
        const full = path.join(logsDir, name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          /* file vanished between readdir and stat */
        }
        return { full, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first

    for (let i = 0; i < entries.length; i++) {
      // Reserve one slot for the file we're about to create this launch.
      const tooMany = i >= MAX_LOG_FILES - 1;
      const tooOld = now - entries[i].mtimeMs > MAX_LOG_AGE_MS;
      if (tooMany || tooOld) {
        try {
          fs.unlinkSync(entries[i].full);
        } catch {
          /* already gone or locked by another instance */
        }
      }
    }
  } catch {
    // Best-effort housekeeping — never block startup on it.
  }
}

pruneOldLogs();

const logFile = path.join(logsDir, `main-${Date.now()}.log`);
const logStream = fs.createWriteStream(logFile, { flags: "a" });
// Swallow stream errors (EPIPE, write-after-end during shutdown) so they can
// never crash the main process.
logStream.on("error", () => {
  /* logging must never be fatal */
});

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_RE =
  /^(authorization|proxy-authorization|api[-_]?key|token|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|client[-_]?secret|password|passwd|cookie|set-cookie|code[-_]?verifier)$/i;

function sanitizeString(value: string): string {
  return value
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;"]+/gi, `$1${REDACTED}`)
    .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|api[_-]?key|apikey|password|code(?:[_-]?verifier)?)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/(:\/\/)([^/\s:@]+):([^/\s@]+)@/g, `$1${REDACTED}@`);
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen));
  if (!(value instanceof Object)) return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY_RE.test(key)
      ? REDACTED
      : sanitizeValue(nested, seen);
  }
  return sanitized;
}

export function formatLogData(data: unknown): string {
  const sanitized = sanitizeValue(data);
  return typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized, null, 2);
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LOG_LINE_CHARS) return line;
  // Avoid slicing through a surrogate pair (which would emit a lone surrogate,
  // i.e. invalid UTF-8) when the cut lands on a high surrogate.
  const lead = line.charCodeAt(MAX_LOG_LINE_CHARS - 1);
  const end = lead >= 0xd800 && lead <= 0xdbff ? MAX_LOG_LINE_CHARS - 1 : MAX_LOG_LINE_CHARS;
  const dropped = line.length - end;
  return `${line.slice(0, end)}… [truncated ${dropped} chars]`;
}

export function log(label: string, data: unknown): void {
  const ts = new Date().toISOString();
  const line = truncateLine(formatLogData(data));
  logStream.write(`[${ts}] [${label}] ${line}\n`);
}

/** Flush and close the log stream on app shutdown. Safe to call more than once. */
export function closeLogStream(): void {
  try {
    logStream.end();
  } catch {
    /* already closed */
  }
}
