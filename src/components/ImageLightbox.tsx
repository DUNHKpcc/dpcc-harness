import React from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ImageAttachment } from "@/types";

interface ImageLightboxProps {
  image: ImageAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Full-size read-only image viewer for images already sent in messages. */
export const ImageLightbox = React.memo(function ImageLightbox({
  image,
  open,
  onOpenChange,
}: ImageLightboxProps) {
  const { t } = useTranslation("workspace");
  if (!image) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(76vh,640px)] w-[min(92vw,960px)] max-w-none items-center justify-center overflow-hidden border-border/40 bg-background/95 p-4 shadow-2xl sm:max-w-none">
        <DialogTitle className="sr-only">{t("imageLightbox.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("imageLightbox.description")}
        </DialogDescription>
        <img
          src={`data:${image.mediaType};base64,${image.data}`}
          alt={image.fileName ?? "attached image"}
          className="h-full w-full rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  );
});
