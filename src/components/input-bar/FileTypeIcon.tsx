import { memo } from "react";
import {
  File,
  FileCode,
  FileText,
  FileSpreadsheet,
  FileArchive,
  FileAudio,
  FileVideo,
  FileImage,
  Folder,
  Presentation,
  Braces,
  Terminal,
  type LucideIcon,
} from "lucide-react";

/** Extension → lucide icon mapping for file chips shown in the input bar.
 *  Keep the set small and obvious; everything unknown falls back to `File`. */
const ICON_BY_EXT: Record<string, LucideIcon> = {
  // Code
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode, mjs: FileCode, cjs: FileCode,
  py: FileCode, rb: FileCode, php: FileCode, go: FileCode, rs: FileCode,
  java: FileCode, kt: FileCode, swift: FileCode,
  c: FileCode, h: FileCode, cpp: FileCode, hpp: FileCode, cc: FileCode,
  cs: FileCode, scala: FileCode, lua: FileCode, dart: FileCode,
  html: FileCode, htm: FileCode, css: FileCode, scss: FileCode, sass: FileCode, less: FileCode,
  vue: FileCode, svelte: FileCode,
  // Shell / config
  sh: Terminal, bash: Terminal, zsh: Terminal, fish: Terminal, ps1: Terminal,
  json: Braces, jsonc: Braces, yml: Braces, yaml: Braces, toml: Braces, xml: Braces,
  ini: Braces, env: Braces,
  // Docs / text
  md: FileText, mdx: FileText, txt: FileText, log: FileText, rtf: FileText,
  pdf: FileText, doc: FileText, docx: FileText, ppt: Presentation, pptx: Presentation,
  // Data
  csv: FileSpreadsheet, tsv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet, ods: FileSpreadsheet,
  // Archives
  zip: FileArchive, tar: FileArchive, gz: FileArchive, bz2: FileArchive,
  rar: FileArchive, "7z": FileArchive,
  // Media
  mp3: FileAudio, wav: FileAudio, flac: FileAudio, ogg: FileAudio, m4a: FileAudio,
  mp4: FileVideo, mov: FileVideo, webm: FileVideo, mkv: FileVideo, avi: FileVideo,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage,
  svg: FileImage, bmp: FileImage, ico: FileImage,
};

export interface FileTypeIconProps {
  fileName: string;
  className?: string;
  isDirectory?: boolean;
}

export const FileTypeIcon = memo(function FileTypeIcon({
  fileName,
  className,
  isDirectory = false,
}: FileTypeIconProps) {
  const ext = fileName.includes(".")
    ? fileName.split(".").pop()!.toLowerCase()
    : "";
  const Icon = isDirectory ? Folder : ICON_BY_EXT[ext] ?? File;
  const color = isDirectory ? "text-amber-500"
    : ["doc", "docx"].includes(ext) ? "text-blue-600 dark:text-blue-400"
    : ["xls", "xlsx", "ods", "csv", "tsv"].includes(ext) ? "text-emerald-600 dark:text-emerald-400"
    : ["ppt", "pptx"].includes(ext) ? "text-orange-600 dark:text-orange-400"
    : ext === "pdf" ? "text-red-600 dark:text-red-400"
    : ["zip", "tar", "gz", "bz2", "rar", "7z"].includes(ext) ? "text-amber-600 dark:text-amber-400"
    : ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext) ? "text-violet-600 dark:text-violet-400"
    : ["mp3", "wav", "flac", "ogg", "m4a"].includes(ext) ? "text-pink-600 dark:text-pink-400"
    : ["mp4", "mov", "webm", "mkv", "avi"].includes(ext) ? "text-indigo-600 dark:text-indigo-400"
    : ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "html", "css", "sh"].includes(ext) ? "text-cyan-600 dark:text-cyan-400"
    : "text-muted-foreground";
  return <Icon className={`${color} ${className ?? ""}`} />;
});
