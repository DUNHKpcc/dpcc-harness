import path from "path";
import fs from "fs";
import { app } from "electron";

// `app.getPath("userData")` is only guaranteed after Electron emits `ready`.
// This module is imported by IPC/background code during main-process startup, so
// keep all filesystem/app-path work lazy and non-fatal.
let logsDir: string | null = null;
let logFile: string | null = null;
let logStream: fs.WriteStream | null = null;
let logStreamClosed = false;
let readyInitScheduled = false;

const PENDING_LOG_LIMIT = 100;
const pendingLogLines: string[] = [];

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

function resolveLogsDir(): string | null {
  if (logsDir) return logsDir;

  if (app.isPackaged) {
    if (!app.isReady()) return null;
    logsDir = path.join(app.getPath("userData"), "logs");
  } else {
    logsDir = path.join(__dirname, "..", "..", "logs");
  }

  return logsDir;
}

function pruneOldLogs(dir: string): void {
  try {
    const now = Date.now();
    const entries = fs
      .readdirSync(dir)
      .filter((name) => LOG_FILE_RE.test(name))
      .map((name) => {
        const full = path.join(dir, name);
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

function scheduleReadyInit(): void {
  if (readyInitScheduled || !app.isPackaged || app.isReady()) return;
  readyInitScheduled = true;
  void app.whenReady().then(() => {
    readyInitScheduled = false;
    const stream = getLogStream();
    if (!stream) return;
    for (const line of pendingLogLines.splice(0)) {
      stream.write(line);
    }
  });
}

function getLogStream(): fs.WriteStream | null {
  if (logStream || logStreamClosed) return logStream;

  const dir = resolveLogsDir();
  if (!dir) {
    scheduleReadyInit();
    return null;
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    pruneOldLogs(dir);

    logFile = path.join(dir, `main-${Date.now()}.log`);
    logStream = fs.createWriteStream(logFile, { flags: "a" });
    // Swallow stream errors (EPIPE, write-after-end during shutdown) so they can
    // never crash the main process.
    logStream.on("error", () => {
      /* logging must never be fatal */
    });
    return logStream;
  } catch {
    // Logging must never prevent Electron startup.
    return null;
  }
}

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
  const line = `[${ts}] [${label}] ${truncateLine(formatLogData(data))}\n`;
  const stream = getLogStream();
  if (stream) {
    stream.write(line);
    return;
  }

  pendingLogLines.push(line);
  if (pendingLogLines.length > PENDING_LOG_LIMIT) pendingLogLines.shift();
}

/** Flush and close the log stream on app shutdown. Safe to call more than once. */
export function closeLogStream(): void {
  logStreamClosed = true;
  pendingLogLines.length = 0;
  try {
    logStream?.end();
  } catch {
    /* already closed */
  } finally {
    logStream = null;
  }
}
