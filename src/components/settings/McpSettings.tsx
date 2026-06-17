import { Plug, PanelRight, FolderOpen, Activity } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

export function McpSettings() {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
          <Plug className="h-7 w-7 text-foreground/80" />
        </div>
        <h2 className="mt-1 text-xl font-semibold text-foreground">{t("mcp.title")}</h2>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          <Trans
            i18nKey="mcp.intro"
            ns="settings"
            components={[
              <Plug key="icon" className="inline h-3.5 w-3.5 -translate-y-px text-foreground/70" />,
              <span key="label" className="font-medium text-foreground" />,
            ]}
          />
        </p>

        <div className="mt-4 w-full space-y-3 rounded-xl border border-border/50 bg-muted/20 px-5 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            {t("mcp.whyTitle")}
          </h3>
          <div className="flex gap-3">
            <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">{t("mcp.perProjectTitle")}</span>{" "}
              &mdash; {t("mcp.perProjectDesc")}
            </p>
          </div>
          <div className="flex gap-3">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">{t("mcp.liveStatusTitle")}</span>{" "}
              &mdash; {t("mcp.liveStatusDesc")}
            </p>
          </div>
          <div className="flex gap-3">
            <PanelRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/90">{t("mcp.alwaysTitle")}</span>{" "}
              &mdash; {t("mcp.alwaysDesc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
