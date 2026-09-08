import fs from "fs";
import path from "path";
import type { FilePreviewKind, FilePreviewResult } from "@shared/types/file-preview";

export const MAX_FILE_PREVIEW_BYTES = 50 * 1024 * 1024;

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const IMAGE_EXTENSIONS = new Set([
  ".avif", ".bmp", ".gif", ".heic", ".heif", ".ico", ".jpeg", ".jpg", ".jxl", ".png", ".svg", ".tif", ".tiff", ".webp",
]);
const OFFICE_EXTENSIONS = new Set([
  ".doc", ".docm", ".docx", ".dot", ".dotm", ".dotx",
  ".odt", ".rtf",
  ".pdf",
  ".odp", ".ppt", ".pptm", ".pptx", ".pot", ".potm", ".potx", ".ppsx", ".ppsm",
  ".csv", ".fods", ".ods", ".tsv", ".xls", ".xla", ".xlam", ".xlsb", ".xlsm", ".xlsx", ".xlt", ".xltm", ".xltx",
]);

function fileName(filePath: string): string {
  return path.basename(filePath) || filePath;
}

function isTextBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.length === 0) return true;

  let controlBytes = 0;
  for (const byte of sample) {
    const allowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !allowedControl) controlBytes += 1;
  }
  return controlBytes / sample.length <= 0.1;
}

export function previewKindForPath(filePath: string, buffer?: Buffer): FilePreviewKind {
  const extension = path.extname(filePath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (OFFICE_EXTENSIONS.has(extension)) return "office";
  return buffer && isTextBuffer(buffer) ? "code" : "unsupported";
}

export async function readFilePreview(
  filePath: string,
  maxBytes = MAX_FILE_PREVIEW_BYTES,
): Promise<FilePreviewResult> {
  const absPath = path.resolve(filePath);
  const name = fileName(filePath);
  const extension = path.extname(absPath).toLowerCase();

  if (!absPath || absPath === path.sep) {
    return { kind: "unsupported", fileName: name, extension, size: 0, error: "Invalid file path" };
  }

  try {
    const stat = await fs.promises.stat(absPath);
    if (!stat.isFile()) {
      return { kind: "unsupported", fileName: name, extension, size: 0, error: `${name} is not a regular file` };
    }
    if (stat.size > maxBytes) {
      return {
        kind: "unsupported",
        fileName: name,
        extension,
        size: stat.size,
        error: `${name} is too large to preview (${Math.ceil(stat.size / 1024 / 1024)}MB, limit ${Math.floor(maxBytes / 1024 / 1024)}MB)`,
      };
    }

    const buffer = await fs.promises.readFile(absPath);
    const kind = previewKindForPath(absPath, buffer);
    if (kind === "unsupported") {
      return { kind, fileName: name, extension, size: stat.size, error: `${name} is not a supported preview format` };
    }
    return { kind, fileName: name, extension, size: stat.size, data: new Uint8Array(buffer) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "unsupported", fileName: name, extension, size: 0, error: message };
  }
}
