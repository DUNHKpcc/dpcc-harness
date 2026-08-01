import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

const FALLBACK_COLORS = [
  "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300",
];

interface PluginIconProps {
  name: string;
  imageUrl?: string;
  size?: "sm" | "md";
}

function stableIndex(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % FALLBACK_COLORS.length;
}

function initials(value: string): string {
  const parts = value
    .replace(/[:/_.-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (parts[0] ?? "P").slice(0, 2).toUpperCase();
}

export function skillPublisherIconUrl(source: string): string | undefined {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) return undefined;
  return `https://github.com/${encodeURIComponent(source.split("/")[0])}.png?size=80`;
}

export function repositoryPublisherIconUrl(repositoryUrl: string | undefined): string | undefined {
  if (!repositoryUrl) return undefined;
  try {
    const url = new URL(repositoryUrl);
    if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname)) {
      return undefined;
    }
    const [owner] = url.pathname.split("/").filter(Boolean);
    return owner ? `https://github.com/${encodeURIComponent(owner)}.png?size=80` : undefined;
  } catch {
    return undefined;
  }
}

export function PluginIcon({ name, imageUrl, size = "md" }: PluginIconProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const label = useMemo(() => initials(name), [name]);
  const color = FALLBACK_COLORS[stableIndex(name)];
  const canLoadImage = Boolean(imageUrl && !imageFailed);

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <div
      data-plugin-icon={imageUrl && !imageFailed ? "image" : "fallback"}
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden border border-border/65",
        size === "sm" ? "h-9 w-9 rounded-md" : "h-11 w-11 rounded-md",
        imageLoaded ? "bg-background" : color,
      )}
    >
      {canLoadImage && (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          className={cn(
            "absolute inset-0 h-full w-full object-contain transition-opacity duration-150",
            size === "sm" ? "p-1" : "p-1.5",
            imageLoaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageLoaded(false);
            setImageFailed(true);
          }}
        />
      )}
      {!imageLoaded && (
        <span className={cn("font-semibold", size === "sm" ? "text-[10px]" : "text-xs")}>{label}</span>
      )}
    </div>
  );
}
