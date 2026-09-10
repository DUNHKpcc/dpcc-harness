import { lazy, memo, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { File, FileWarning, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import FileViewer from "@file-viewer/react";
import { officeRenderers } from "@file-viewer/preset-office";
import { liteRenderers } from "@file-viewer/preset-lite";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useResolvedTheme } from "@/hooks/useTheme";
import {
  decodePreviewText,
  shouldUseMonacoPreview,
  toPreviewArrayBuffer,
  type MarkdownPreviewMode,
} from "@/lib/file-preview";
import { getLanguageFromPath } from "@/lib/languages";
import { disableMonacoDiagnostics, getMonacoLanguageFromPath } from "@/lib/monaco";
import { captureException } from "@/lib/analytics/analytics";
import type { FilePreviewResult } from "@shared/types/file-preview";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({ default: mod.default })),
);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ListToggleButton({ hidden, label, onToggle }: { hidden: boolean; label?: string; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onToggle} className="inline-file-preview-list-toggle" aria-label={label}>
          {hidden ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}><p className="text-xs">{label}</p></TooltipContent>
    </Tooltip>
  );
}

export const InlineFilePreview = memo(function InlineFilePreview({
  filePath,
  isListHidden = false,
  onToggleList,
  listToggleLabel,
}: {
  filePath: string | null;
  isListHidden?: boolean;
  onToggleList?: () => void;
  listToggleLabel?: string;
}) {
  const { t } = useTranslation("tools");
  const [preview, setPreview] = useState<FilePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [markdownMode, setMarkdownMode] = useState<MarkdownPreviewMode>("preview");
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    if (!filePath) {
      setPreview(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setMarkdownMode("preview");

    void window.claude.previewFile(filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.kind === "unsupported") {
          setPreview(result);
          return;
        }
        if (result.error) setError(result.error);
        else setPreview(result);
      })
      .catch((err) => {
        if (cancelled) return;
        const reason = err instanceof Error ? err : new Error(String(err));
        captureException(reason, { label: "FILE_READ_ERR" });
        setError(reason.message || t("filePreview.readError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, t]);

  const fileName = filePath?.split("/").pop() ?? "";
  const dirPath = filePath?.split("/").slice(0, -1).join("/") ?? "";
  const language = filePath ? getLanguageFromPath(filePath) : "";
  const monacoLanguage = filePath ? getMonacoLanguageFromPath(filePath) : "plaintext";
  const content = preview && shouldUseMonacoPreview(preview.kind, markdownMode)
    ? decodePreviewText(preview.data)
    : null;
  const lineCount = content ? content.split("\n").length : 0;

  if (!filePath) {
    return (
      <div className="inline-file-preview-placeholder">
        {onToggleList && (
          <ListToggleButton hidden={isListHidden} label={listToggleLabel} onToggle={onToggleList} />
        )}
        {t("filePreview.selectFile")}
      </div>
    );
  }

  return (
    <div className="inline-file-preview-shell">
      <div className="inline-file-preview-header">
        <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{fileName}</div>
          <div className="truncate text-[10px] text-muted-foreground/60">{dirPath}</div>
        </div>
        {preview?.kind === "markdown" && (
          <div className={`inline-file-preview-mode-switch ${markdownMode === "source" ? "is-source" : ""}`} role="group" aria-label={t("filePreview.markdownMode")}>
            <span className="inline-file-preview-mode-thumb" aria-hidden="true" />
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className={`relative z-[1] h-5 min-w-0 px-2 text-[10px] ${markdownMode === "preview" ? "text-foreground" : "text-muted-foreground/70"}`}
              onClick={() => setMarkdownMode("preview")}
            >
              {t("filePreview.preview")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className={`relative z-[1] h-5 min-w-0 px-2 text-[10px] ${markdownMode === "source" ? "text-foreground" : "text-muted-foreground/70"}`}
              onClick={() => setMarkdownMode("source")}
            >
              {t("filePreview.source")}
            </Button>
          </div>
        )}
        {onToggleList && (
          <ListToggleButton hidden={isListHidden} label={listToggleLabel} onToggle={onToggleList} />
        )}
        <OpenInEditorButton filePath={filePath} />
      </div>

      <div className="inline-file-preview-content">
        {loading && (
          <div className="inline-file-preview-state">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
          </div>
        )}
        {error && (
          <div className="inline-file-preview-state"><p className="text-center text-xs text-muted-foreground/60">{error}</p></div>
        )}
        {content !== null && !loading && (
          <Suspense
            fallback={
              <div className="inline-file-preview-state">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
              </div>
            }
          >
            <MonacoEditor
              height="100%"
              language={monacoLanguage}
              value={content}
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              beforeMount={disableMonacoDiagnostics}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                lineNumbers: "on",
                wordWrap: "on",
                automaticLayout: true,
                domReadOnly: true,
                renderLineHighlight: "none",
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                padding: { top: 8, bottom: 8 },
              }}
            />
          </Suspense>
        )}
        {preview && !loading && content === null && preview.data && (
          <FileViewer
            className="h-full min-h-0"
            buffer={toPreviewArrayBuffer(preview.data)}
            name={preview.fileName}
            type={preview.extension.slice(1)}
            size={preview.size}
            options={{
              preset: [officeRenderers, liteRenderers],
              rendererMode: "replace",
              theme: resolvedTheme === "dark" ? "dark" : "light",
              styleIsolation: "auto",
              toolbar: { download: false, print: false, exportHtml: false },
              ui: { density: "compact", surfaceBackground: "transparent" },
            }}
          />
        )}
        {preview?.kind === "unsupported" && !loading && (
          <UnsupportedPreview error={preview.error ?? t("filePreview.unsupported")} />
        )}
      </div>

      {preview && !loading && (
        <div className="inline-file-preview-footer">
          {content !== null && <><span>{t("filePreview.lines", { count: lineCount })}</span><span className="text-muted-foreground/30">•</span><span>{language}</span><span className="text-muted-foreground/30">•</span></>}
          <span>{formatFileSize(preview.size)}</span>
        </div>
      )}
    </div>
  );
});

function UnsupportedPreview({ error }: { error: string }) {
  return (
    <div className="inline-file-preview-state">
      <div className="inline-file-preview-empty">
        <FileWarning className="h-5 w-5" />
        <p>{error}</p>
      </div>
    </div>
  );
}
