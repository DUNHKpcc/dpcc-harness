import { memo } from "react";
import { cn } from "@/lib/utils";
import { FileTypeIcon } from "./FileTypeIcon";

interface FileAttachmentTileProps {
  fileName: string;
  path: string;
  size?: number;
  isDirectory?: boolean;
  variant: "composer" | "message";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileAttachmentTile = memo(function FileAttachmentTile({
  fileName,
  path,
  size,
  isDirectory = false,
  variant,
}: FileAttachmentTileProps) {
  const isComposer = variant === "composer";
  const extension = isDirectory ? "Folder" : fileName.includes(".")
    ? fileName.split(".").pop()!.toUpperCase()
    : "File";

  return (
    <div
      data-slot="file-attachment-tile"
      data-variant={variant}
      className={cn(
        "group/file relative flex shrink-0 flex-col items-center justify-between overflow-hidden rounded-xl border border-border/40 bg-foreground/[0.045] text-center shadow-sm",
        isComposer ? "size-16 px-1 py-1.5" : "size-20 px-1.5 py-2",
      )}
      title={path}
    >
      <FileTypeIcon
        fileName={fileName}
        isDirectory={isDirectory}
        className={cn("shrink-0", "size-6")}
      />
      <div className="w-full min-w-0">
        <span className={cn("block truncate font-medium leading-tight text-foreground", isComposer ? "text-[9px]" : "text-[10px]")} title={fileName}>
          {fileName}
        </span>
        <span className={cn("mt-0.5 block truncate text-muted-foreground", isComposer ? "text-[8px]" : "text-[9px]")}>
          {size === undefined ? extension : `${extension} · ${formatBytes(size)}`}
        </span>
      </div>
    </div>
  );
});
