import { lazy, memo, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { File, Loader2 } from "lucide-react";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { useResolvedTheme } from "@/hooks/useTheme";
import { getLanguageFromPath } from "@/lib/languages";
import { disableMonacoDiagnostics, getMonacoLanguageFromPath } from "@/lib/monaco";
import { captureException } from "@/lib/analytics/analytics";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({ default: mod.default })),
);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const InlineFilePreview = memo(function InlineFilePreview({
  filePath,
}: {
  filePath: string | null;
}) {
  const { t } = useTranslation("tools");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    void window.claude.readFile(filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
        } else {
          setContent(result.content ?? "");
        }
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
  const lineCount = content ? content.split("\n").length : 0;
  const fileSize = content ? formatFileSize(new Blob([content]).size) : "";

  if (!filePath) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-center text-xs text-muted-foreground/50">
        {t("filePreview.selectFile")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2 border-b border-foreground/[0.08] px-3 py-2">
        <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{fileName}</div>
          <div className="truncate text-[10px] text-muted-foreground/60">{dirPath}</div>
        </div>
        <OpenInEditorButton filePath={filePath} />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
          </div>
        )}
        {error && (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-center text-xs text-muted-foreground/60">{error}</p>
          </div>
        )}
        {content !== null && !loading && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
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
      </div>

      {content !== null && !loading && (
        <div className="flex items-center gap-2 border-t border-foreground/[0.08] px-3 py-1 text-[10px] text-muted-foreground/50">
          <span>{t("filePreview.lines", { count: lineCount })}</span>
          <span className="text-muted-foreground/30">•</span>
          <span>{language}</span>
          <span className="text-muted-foreground/30">•</span>
          <span>{fileSize}</span>
        </div>
      )}
    </div>
  );
});
