/** Rendering family selected from a verified local file before it reaches the renderer. */
export type FilePreviewKind = "code" | "image" | "markdown" | "office" | "unsupported";

/**
 * A bounded file payload for the renderer preview surface. Binary content stays
 * binary until a renderer that understands its format consumes it.
 */
export interface FilePreviewResult {
  kind: FilePreviewKind;
  fileName: string;
  extension: string;
  size: number;
  data?: Uint8Array;
  error?: string;
}
