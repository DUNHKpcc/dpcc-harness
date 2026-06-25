import fs from "fs";
import path from "path";

export const MAX_PROMPT_TEXT_FILE_BYTES = 500_000;

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avif",
  ".bmp",
  ".class",
  ".doc",
  ".docx",
  ".exe",
  ".gif",
  ".gz",
  ".heic",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".tar",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

export interface PromptTextFileReadResult {
  content?: string;
  error?: string;
}

export interface PromptTextFileCheckResult {
  ok: boolean;
  size?: number;
  error?: string;
}

function displayName(filePath: string): string {
  return path.basename(filePath) || filePath;
}

function formatKb(bytes: number): number {
  return Math.ceil(bytes / 1024);
}

function isKnownBinaryPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function looksLikeBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.length === 0) return false;

  let suspicious = 0;
  for (const byte of sample) {
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !isAllowedControl) suspicious += 1;
  }
  return suspicious / sample.length > 0.1;
}

export async function readPromptTextFile(
  filePath: string,
  maxBytes = MAX_PROMPT_TEXT_FILE_BYTES,
): Promise<PromptTextFileReadResult> {
  const check = await checkPromptTextFile(filePath, maxBytes);
  if (!check.ok) {
    return { error: check.error ?? "Unable to read file" };
  }

  const buffer = await fs.promises.readFile(path.resolve(filePath));
  return { content: buffer.toString("utf-8") };
}

export async function checkPromptTextFile(
  filePath: string,
  maxBytes = MAX_PROMPT_TEXT_FILE_BYTES,
): Promise<PromptTextFileCheckResult> {
  const absPath = path.resolve(filePath);
  if (!absPath || absPath === path.sep) {
    return { ok: false, error: "Invalid file path" };
  }

  const stat = await fs.promises.stat(absPath);
  if (!stat.isFile()) {
    return { ok: false, error: `${displayName(filePath)} is not a regular file` };
  }
  if (stat.size > maxBytes) {
    return {
      ok: false,
      error: `${displayName(filePath)} is too large (${formatKb(stat.size)}KB, limit ${formatKb(maxBytes)}KB)`,
    };
  }
  if (isKnownBinaryPath(absPath)) {
    return { ok: false, error: `${displayName(filePath)} appears to be a binary file` };
  }

  const buffer = await fs.promises.readFile(absPath);
  if (looksLikeBinary(buffer)) {
    return { ok: false, error: `${displayName(filePath)} appears to be a binary file` };
  }

  return { ok: true, size: stat.size };
}
