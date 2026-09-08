import type { FilePreviewKind } from "@shared/types/file-preview";

export type MarkdownPreviewMode = "preview" | "source";

export function shouldUseMonacoPreview(
  kind: FilePreviewKind,
  markdownMode: MarkdownPreviewMode,
): boolean {
  return kind === "code" || (kind === "markdown" && markdownMode === "source");
}

export function decodePreviewText(data: Uint8Array | undefined): string {
  return data ? new TextDecoder().decode(data) : "";
}

export function toPreviewArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
