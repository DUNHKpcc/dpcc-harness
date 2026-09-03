import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ImageAttachment, FileAttachment, GrabbedElement } from "@/types";
import { FileTypeIcon } from "./FileTypeIcon";

export interface AttachmentPreviewProps {
  attachments: ImageAttachment[];
  onRemoveAttachment: (id: string) => void;
  onEditAttachment: (attachment: ImageAttachment) => void;
  fileAttachments: FileAttachment[];
  onRemoveFileAttachment: (id: string) => void;
  grabbedElements: GrabbedElement[];
  onRemoveGrabbedElement: (id: string) => void;
}

/** Format a file size as B / KB / MB. Keep one decimal for KB/MB. */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Image attachment thumbnails, selected/dropped file chips, and grabbed DOM element
 *  context chips above the toolbar. */
export const AttachmentPreview = memo(function AttachmentPreview({
  attachments,
  onRemoveAttachment,
  onEditAttachment,
  fileAttachments,
  onRemoveFileAttachment,
  grabbedElements,
  onRemoveGrabbedElement,
}: AttachmentPreviewProps) {
  const { t } = useTranslation("input");
  const hasAttachments = attachments.length > 0;
  const hasFileAttachments = fileAttachments.length > 0;
  const hasGrabbedElements = grabbedElements.length > 0;

  if (!hasAttachments && !hasFileAttachments && !hasGrabbedElements) return null;

  return (
    <>
      {/* Image thumbnails and their separate action rails. */}
      {hasAttachments && (
        <div className="flex flex-wrap gap-2.5 px-5 pb-2.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              data-slot="image-attachment"
              className="flex h-16 shrink-0 items-center gap-1.5"
            >
              <button
                type="button"
                data-slot="image-attachment-thumbnail"
                className="group/thumb size-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border/30 shadow-sm ring-1 ring-inset ring-white/[0.04] transition-all duration-200 hover:border-border/50 hover:shadow-md focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                onClick={() => onEditAttachment(att)}
                aria-label={t("attachments.editImage")}
              >
                <img
                  src={`data:${att.mediaType};base64,${att.data}`}
                  alt={att.fileName ?? "attachment"}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover/thumb:scale-105"
                />
              </button>

              <div
                data-slot="image-attachment-actions"
                className="flex h-16 w-6 shrink-0 flex-col justify-between"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      data-slot="image-attachment-edit"
                      onClick={() => onEditAttachment(att)}
                      className="size-6 rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                      aria-label={t("attachments.editImage")}
                    >
                      <Pencil className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {t("attachments.editImage")}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      data-slot="image-attachment-remove"
                      onClick={() => onRemoveAttachment(att.id)}
                      className="size-6 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t("attachments.removeImage")}
                    >
                      <X className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {t("attachments.removeImage")}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Non-image file chips (selected or dropped from Finder / Explorer) */}
      {hasFileAttachments && (
        <div className="flex flex-wrap gap-2.5 px-5 pb-2.5">
          {fileAttachments.map((fa) => (
            <div
              key={fa.id}
              className="group/file relative flex items-center gap-2.5 rounded-xl border border-border/30 bg-foreground/[0.04] px-3 py-2 shadow-sm transition-all duration-150 hover:border-border/50 hover:bg-foreground/[0.06]"
              title={`Path reference. The agent will read this file on demand: ${fa.path}`}
            >
              <FileTypeIcon
                fileName={fa.fileName}
                className="h-4 w-4 shrink-0 text-muted-foreground"
              />
              <div className="flex max-w-56 flex-col">
                <span className="truncate text-[11px] font-medium text-foreground/85">
                  {fa.fileName}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatBytes(fa.size)} · path reference
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onRemoveFileAttachment(fa.id)}
                className="absolute -end-1 -top-1 size-4 rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-background/95 hover:text-foreground group-hover/file:opacity-100"
              >
                <X className="size-2.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Grabbed element preview chips (from browser inspector) */}
      {hasGrabbedElements && (
        <div className="flex flex-wrap gap-2.5 px-5 pb-2.5">
          {grabbedElements.map((ge) => (
            <div
              key={ge.id}
              className="group/grab relative flex items-center gap-2.5 rounded-xl border border-blue-500/15 bg-blue-500/5 px-3 py-2 shadow-sm transition-all duration-150 hover:border-blue-500/25 hover:bg-blue-500/8"
            >
              <Crosshair className="h-3.5 w-3.5 shrink-0 text-blue-400" />
              <div className="flex flex-col">
                <span className="text-[11px] font-mono font-medium text-foreground/80">
                  {"<"}
                  {ge.tag}
                  {">"}
                  {ge.attributes?.id && (
                    <span className="text-blue-400">#{ge.attributes.id}</span>
                  )}
                  {ge.classes?.length > 0 && (
                    <span className="text-foreground/40">
                      .{ge.classes.slice(0, 2).join(".")}
                    </span>
                  )}
                </span>
                {ge.textContent && (
                  <span className="max-w-64 truncate text-[10px] text-muted-foreground/70">
                    {ge.textContent.trim().replace(/\s+/g, " ")}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onRemoveGrabbedElement(ge.id)}
                className="absolute -end-1 -top-1 size-4 rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-background/95 hover:text-foreground group-hover/grab:opacity-100"
              >
                <X className="size-2.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
});
