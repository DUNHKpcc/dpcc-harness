import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  FolderTree,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  Copy,
  ClipboardCopy,
  ExternalLink,
  Eye,
  FolderSearch,
  Pencil,
  Trash2,
  FilePlus,
  FolderPlus,
  Type,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelHeader } from "@/components/PanelHeader";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { InlineFilePreview } from "./InlineFilePreview";
import { useFileBrowserResize } from "@/hooks/useFileBrowserResize";
import { useProjectFiles } from "@/hooks/useProjectFiles";
import {
  filterTree,
  flattenTree,
  countFiles,
  collectDirPaths,
  type FileTreeNode,
} from "@/lib/file-tree";
import { copyToClipboard } from "@/lib/clipboard";
import { isMac, isImeComposing } from "@/lib/utils";

// ── File icon by extension ──

const EXTENSION_ICON_COLORS: Record<string, string> = {
  ts: "text-blue-400",
  tsx: "text-blue-400",
  js: "text-yellow-400",
  jsx: "text-yellow-400",
  json: "text-yellow-600",
  css: "text-purple-400",
  scss: "text-pink-400",
  html: "text-orange-400",
  md: "text-gray-400",
  py: "text-green-400",
  rs: "text-orange-500",
  go: "text-cyan-400",
  svg: "text-amber-400",
  yaml: "text-red-300",
  yml: "text-red-300",
  toml: "text-gray-500",
  sh: "text-green-500",
};

function getFileIconColor(extension?: string): string {
  if (!extension) return "text-muted-foreground/70";
  return EXTENSION_ICON_COLORS[extension] ?? "text-muted-foreground/70";
}

/** Get the parent directory of a path (e.g. "src/lib/foo.ts" → "src/lib"). */
function dirname(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

// ── Props ──

interface ProjectFilesPanelProps {
  cwd?: string;
  enabled: boolean;
  headerControls?: React.ReactNode;
}

function findFirstFile(nodes: FileTreeNode[]): FileTreeNode | null {
  for (const node of nodes) {
    if (node.type === "file") return node;
    const child = findFirstFile(node.children ?? []);
    if (child) return child;
  }
  return null;
}

function hasFilePath(nodes: FileTreeNode[], path: string): boolean {
  return nodes.some((node) => (
    node.type === "file"
      ? node.path === path
      : hasFilePath(node.children ?? [], path)
  ));
}

function getAncestorDirs(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

// ── Component ──

export const ProjectFilesPanel = memo(function ProjectFilesPanel({
  cwd,
  enabled,
  headerControls,
}: ProjectFilesPanelProps) {
  const { t } = useTranslation("tools");
  const { tree, loading, error, refresh } = useProjectFiles(cwd, enabled);

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const fileBrowserResize = useFileBrowserResize();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Inline creation state: { parentDir (relative), type }
  const [creating, setCreating] = useState<{ parentDir: string; type: "file" | "folder" } | null>(null);

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 200);
  }, []);

  // Filter tree by search query
  const filteredTree = useMemo(() => {
    if (!tree) return null;
    if (!debouncedQuery.trim()) return tree;
    return filterTree(tree, debouncedQuery);
  }, [tree, debouncedQuery]);

  // When searching, auto-expand all matching directories
  const effectiveExpanded = useMemo(() => {
    if (!filteredTree || !debouncedQuery.trim()) return expandedDirs;
    return collectDirPaths(filteredTree);
  }, [filteredTree, debouncedQuery, expandedDirs]);

  // Flatten for rendering
  const flatItems = useMemo(() => {
    if (!filteredTree) return [];
    return flattenTree(filteredTree, effectiveExpanded);
  }, [filteredTree, effectiveExpanded]);

  const totalFiles = useMemo(() => (tree ? countFiles(tree) : 0), [tree]);

  useEffect(() => {
    if (!cwd || !tree) {
      if (selectedFilePath) setSelectedFilePath(null);
      return;
    }
    const relativePath = selectedFilePath?.startsWith(`${cwd}/`)
      ? selectedFilePath.slice(cwd.length + 1)
      : null;
    if (relativePath && hasFilePath(tree, relativePath)) return;

    const firstFile = findFirstFile(tree);
    if (firstFile) {
      setExpandedDirs((previous) => new Set([...previous, ...getAncestorDirs(firstFile.path)]));
    }
    setSelectedFilePath(firstFile ? `${cwd}/${firstFile.path}` : null);
  }, [cwd, selectedFilePath, tree]);

  // Toggle directory expanded state
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Handle file row click
  const handleFileClick = useCallback((node: FileTreeNode) => {
    if (cwd) setSelectedFilePath(`${cwd}/${node.path}`);
  }, [cwd]);

  // Start inline creation under a directory
  const handleStartCreate = useCallback((parentDir: string, type: "file" | "folder") => {
    // Ensure the parent is expanded so the inline input is visible
    setExpandedDirs((prev) => {
      if (prev.has(parentDir)) return prev;
      const next = new Set(prev);
      next.add(parentDir);
      return next;
    });
    setCreating({ parentDir, type });
  }, []);

  // Commit inline creation
  const handleCommitCreate = useCallback(async (name: string) => {
    if (!cwd || !creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setCreating(null);
      return;
    }
    const fullPath = `${cwd}/${creating.parentDir ? `${creating.parentDir}/` : ""}${trimmed}`;
    const result = creating.type === "file"
      ? await window.claude.newFile(fullPath)
      : await window.claude.newFolder(fullPath);

    setCreating(null);
    if (result.ok) {
      refresh();
    }
  }, [cwd, creating, refresh]);

  const handleCancelCreate = useCallback(() => {
    setCreating(null);
  }, []);

  if (!cwd) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader icon={FolderTree} label={t("projectFiles.title")} iconClass="text-teal-600/70 dark:text-teal-200/50">
          {headerControls}
        </PanelHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-1">
          <FolderTree className="h-3.5 w-3.5 text-foreground/15" />
          <p className="text-[10px] text-foreground/30">{t("projectFiles.noProject")}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-file-browser-layout="project-files" className="file-browser-layout flex h-full min-h-0 min-w-0 flex-col">
      <div ref={fileBrowserResize.contentRef} className="file-browser-content min-h-0 flex-1" style={fileBrowserResize.contentStyle}>
        <section data-file-browser-preview className="file-browser-preview">
          <InlineFilePreview filePath={selectedFilePath} />
        </section>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整文件列表宽度"
          data-file-browser-resize-handle
          className="file-browser-resize-handle group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
          onMouseDown={fileBrowserResize.handleResizeStart}
        >
          <div className={`h-10 w-0.5 rounded-full transition-colors duration-150 ${fileBrowserResize.isResizing ? "bg-foreground/40" : "bg-transparent group-hover:bg-foreground/25"}`} />
        </div>
        <aside data-file-browser-list className="file-browser-list flex flex-col">
          <PanelHeader icon={FolderTree} label={t("projectFiles.title")} iconClass="text-teal-600/70 dark:text-teal-200/50">
            {totalFiles > 0 && (
              <span className="text-[10px] tabular-nums text-foreground/35">{totalFiles}</span>
            )}
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground/35 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/60"
              title={t("projectFiles.refresh")}
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
            {headerControls}
          </PanelHeader>

          <div className="flex items-center gap-1.5 px-3 py-1">
            <Search className="h-3 w-3 shrink-0 text-foreground/25" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("projectFiles.searchPlaceholder")}
              className="h-5 w-full bg-transparent text-[11px] text-foreground/75 outline-none placeholder:text-foreground/25"
            />
          </div>
          <div className="mx-2"><div className="h-px bg-foreground/[0.06]" /></div>

          <ScrollArea className="min-h-0 flex-1">
        {loading && !tree && (
          <div className="flex flex-col items-center justify-center gap-1 py-6">
            <RefreshCw className="h-3 w-3 animate-spin text-foreground/25" />
            <p className="text-[10px] text-foreground/30">{t("projectFiles.loading")}</p>
          </div>
        )}

        {error && (
          <div className="px-3 py-2">
            <p className="text-[10px] text-destructive">{error}</p>
          </div>
        )}

        {flatItems.length === 0 && !loading && !error && tree && (
          <div className="flex items-center justify-center py-6">
            <p className="text-[10px] text-foreground/30">
              {debouncedQuery ? t("projectFiles.noMatches", { query: debouncedQuery }) : t("projectFiles.noFiles")}
            </p>
          </div>
        )}

        <div className="py-1">
          {flatItems.map((item) => (
            <FileTreeRow
              key={item.node.path}
              node={item.node}
              depth={item.depth}
              isExpanded={item.isExpanded}
              isSelected={selectedFilePath === `${cwd}/${item.node.path}`}
              cwd={cwd}
              t={t}
              onToggleDir={toggleDir}
              onFileClick={handleFileClick}
              onRefresh={refresh}
              onStartCreate={handleStartCreate}
              creatingUnder={
                creating && creating.parentDir === item.node.path
                  ? creating.type
                  : null
              }
              onCommitCreate={handleCommitCreate}
              onCancelCreate={handleCancelCreate}
            />
          ))}
          {/* Inline creation at root level */}
          {creating && creating.parentDir === "" && (
            <InlineCreateInput
              depth={0}
              type={creating.type}
              t={t}
              onCommit={handleCommitCreate}
              onCancel={handleCancelCreate}
            />
          )}
        </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
});

// ── InlineCreateInput ──

function InlineCreateInput({
  depth,
  type,
  t,
  onCommit,
  onCancel,
}: {
  depth: number;
  type: "file" | "folder";
  t: TFunction<"tools">;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleBlur = useCallback(() => {
    if (value.trim()) {
      onCommit(value);
    } else {
      onCancel();
    }
  }, [value, onCommit, onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isImeComposing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim()) {
        onCommit(value);
      } else {
        onCancel();
      }
    }
    if (e.key === "Escape") {
      onCancel();
    }
  }, [value, onCommit, onCancel]);

  return (
    <div
      className="flex min-h-7 items-center gap-2 pe-1.5 py-1"
      style={{ paddingInlineStart: (depth + 1) * 14 + 8 }}
    >
      <span className="h-3.5 w-3.5 shrink-0" />
      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm bg-foreground/[0.06]">
        {type === "folder"
          ? <Folder className="h-3.25 w-3.25 text-amber-400/80" />
          : <File className="h-3.25 w-3.25 text-muted-foreground/70" />
        }
      </span>
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={type === "folder" ? t("projectFiles.folderNamePlaceholder") : t("projectFiles.filenamePlaceholder")}
        className="min-w-0 flex-1 rounded bg-foreground/[0.06] px-1.5 py-0.5 text-xs text-foreground outline-none ring-1 ring-foreground/10 focus:ring-foreground/20"
      />
    </div>
  );
}

// ── FileTreeRow ──

interface FileTreeRowProps {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  cwd: string;
  t: TFunction<"tools">;
  onToggleDir: (path: string) => void;
  onFileClick: (node: FileTreeNode, event: React.MouseEvent<HTMLDivElement>) => void;
  onRefresh: () => void;
  onStartCreate: (parentDir: string, type: "file" | "folder") => void;
  creatingUnder: "file" | "folder" | null;
  onCommitCreate: (name: string) => void;
  onCancelCreate: () => void;
}

const FileTreeRow = memo(function FileTreeRow({
  node,
  depth,
  isExpanded,
  isSelected,
  cwd,
  t,
  onToggleDir,
  onFileClick,
  onRefresh,
  onStartCreate,
  creatingUnder,
  onCommitCreate,
  onCancelCreate,
}: FileTreeRowProps) {
  const revealLabel = isMac ? t("projectFiles.menu.revealInFinder") : t("projectFiles.menu.showInExplorer");
  const trashLabel = isMac ? t("projectFiles.menu.moveToTrash") : t("projectFiles.menu.moveToRecycleBin");
  const isDir = node.type === "directory";
  const absolutePath = `${cwd}/${node.path}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameName, setRenameName] = useState(node.name);
  // Track cursor position so the menu opens where the user right-clicked.
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const suppressClickUntilRef = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);

  const suppressRowClick = useCallback((durationMs = 150) => {
    suppressClickUntilRef.current = Date.now() + durationMs;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (Date.now() < suppressClickUntilRef.current) {
        return;
      }
      if (isDir) {
        onToggleDir(node.path);
      } else {
        onFileClick(node, e);
      }
    },
    [isDir, node, onToggleDir, onFileClick],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rowRect = rowRef.current?.getBoundingClientRect();
    setMenuPos({
      x: rowRect ? e.clientX - rowRect.left : e.nativeEvent.offsetX,
      y: rowRect ? e.clientY - rowRect.top : e.nativeEvent.offsetY,
    });
    setMenuOpen(true);
  }, []);

  // ── Copy actions ──

  const handleCopyName = useCallback(() => {
    void copyToClipboard(node.name);
  }, [node.name]);

  const handleCopyPath = useCallback(() => {
    void copyToClipboard(node.path);
  }, [node.path]);

  const handleCopyAbsolutePath = useCallback(() => {
    void copyToClipboard(absolutePath);
  }, [absolutePath]);

  // ── Open / reveal ──

  const handleRevealInFinder = useCallback(() => {
    void window.claude.showItemInFolder(absolutePath);
  }, [absolutePath]);

  const handleOpenInEditor = useCallback(() => {
    void window.claude.openInEditor(absolutePath);
  }, [absolutePath]);

  // ── Rename ──

  const handleStartRename = useCallback(() => {
    setRenameName(node.name);
    setIsRenaming(true);
  }, [node.name]);

  const handleCommitRename = useCallback(async () => {
    const trimmed = renameName.trim();
    setIsRenaming(false);
    if (!trimmed || trimmed === node.name) return;

    const parentDir = dirname(absolutePath);
    const newAbsPath = `${parentDir}/${trimmed}`;
    const result = await window.claude.renameFile(absolutePath, newAbsPath);
    if (result.ok) {
      onRefresh();
    }
  }, [renameName, node.name, absolutePath, onRefresh]);

  // ── Delete (trash) ──

  const handleTrash = useCallback(async () => {
    const result = await window.claude.trashItem(absolutePath);
    if (result.ok) {
      onRefresh();
    }
  }, [absolutePath, onRefresh]);

  // ── New file/folder ──

  const handleNewFile = useCallback(() => {
    const parentDir = isDir ? node.path : dirname(node.path);
    onStartCreate(parentDir, "file");
  }, [isDir, node.path, onStartCreate]);

  const handleNewFolder = useCallback(() => {
    const parentDir = isDir ? node.path : dirname(node.path);
    onStartCreate(parentDir, "folder");
  }, [isDir, node.path, onStartCreate]);

  // Invisible anchor positioned at cursor coordinates inside the row.
  const anchorStyle: CSSProperties = {
    position: "absolute",
    left: menuPos.x,
    top: menuPos.y,
    width: 0,
    height: 0,
    pointerEvents: "none",
  };

  // ── Inline rename mode ──
  if (isRenaming) {
    return (
      <div
        className="flex min-h-7 items-center gap-2 pe-1.5 py-1 bg-foreground/[0.05]"
        style={{ paddingInlineStart: depth * 14 + 8 }}
      >
        {isDir ? (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          </span>
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm bg-foreground/[0.06]">
          {isDir
            ? <Folder className="h-3.25 w-3.25 text-amber-400/80" />
            : <File className={`h-3.25 w-3.25 ${getFileIconColor(node.extension)}`} />
          }
        </span>
        <input
          autoFocus
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onBlur={() => void handleCommitRename()}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              void handleCommitRename();
            }
            if (e.key === "Escape") setIsRenaming(false);
          }}
          className="min-w-0 flex-1 rounded bg-foreground/[0.06] px-1.5 py-0.5 text-xs text-foreground outline-none ring-1 ring-foreground/10 focus:ring-foreground/20"
        />
      </div>
    );
  }

  return (
    <>
      <div
        ref={rowRef}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`group relative flex min-h-7 cursor-pointer items-center gap-2 pe-1.5 py-1 transition-colors duration-75 hover:bg-foreground/[0.05] ${
          isSelected || menuOpen ? "bg-primary/10" : ""
        }`}
        style={{ paddingInlineStart: depth * 14 + 8 }}
      >
        {/* Chevron for directories */}
        {isDir ? (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <ChevronRight
              className={`h-3 w-3 text-muted-foreground/50 transition-transform duration-150 ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          </span>
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}

        {/* Icon */}
        <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm bg-foreground/[0.03] transition-colors duration-150 group-hover:bg-foreground/[0.06]">
          {isDir && isExpanded && <FolderOpen className="h-3.25 w-3.25 text-amber-400/80" />}
          {isDir && !isExpanded && <Folder className="h-3.25 w-3.25 text-amber-400/80" />}
          {!isDir && <File className={`h-3.25 w-3.25 ${getFileIconColor(node.extension)}`} />}
        </span>

        {/* Name */}
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{node.name}</span>

        {/* Reserve the same trailing space for both row types so folders and files align. */}
        <span className="ms-auto flex h-4.5 w-4.5 shrink-0 items-center justify-center">
          {!isDir && (
            <OpenInEditorButton filePath={absolutePath} />
          )}
        </span>

        {/* Context menu — anchored to a 0×0 element at the cursor position */}
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => {
            if (!open) {
              suppressRowClick();
            }
            setMenuOpen(open);
          }}
        >
          <DropdownMenuTrigger asChild>
            <span style={anchorStyle} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-52">
            {!isDir && (
              <>
                <DropdownMenuItem onClick={handleOpenInEditor}>
                  <ExternalLink className="me-2 h-3.5 w-3.5" />
                  {t("projectFiles.menu.openInEditor")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleClick}>
                  <Eye className="me-2 h-3.5 w-3.5" />
                  {t("projectFiles.menu.preview")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleNewFile}>
              <FilePlus className="me-2 h-3.5 w-3.5" />
              {t("projectFiles.menu.newFile")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleNewFolder}>
              <FolderPlus className="me-2 h-3.5 w-3.5" />
              {t("projectFiles.menu.newFolder")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleCopyName}>
              <Type className="me-2 h-3.5 w-3.5" />
              {t("projectFiles.menu.copyName")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyPath}>
              <Copy className="me-2 h-3.5 w-3.5" />
              {t("projectFiles.menu.copyPath")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyAbsolutePath}>
              <ClipboardCopy className="me-2 h-3.5 w-3.5" />
              {t("projectFiles.menu.copyAbsolutePath")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleRevealInFinder}>
              <FolderSearch className="me-2 h-3.5 w-3.5" />
              {revealLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleStartRename}>
              <Pencil className="me-2 h-3.5 w-3.5" />
              {t("projectFiles.menu.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => void handleTrash()}
            >
              <Trash2 className="me-2 h-3.5 w-3.5" />
              {trashLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Inline creation input — rendered directly below this directory row when active */}
      {creatingUnder && isDir && isExpanded && (
        <InlineCreateInput
          depth={depth + 1}
          type={creatingUnder}
          t={t}
          onCommit={onCommitCreate}
          onCancel={onCancelCreate}
        />
      )}
    </>
  );
});
