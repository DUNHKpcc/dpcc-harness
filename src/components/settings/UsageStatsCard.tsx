import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useUsageStats } from "@/hooks/useUsageStats";
import {
  buildHeatmapGrid,
  formatCompactNumber,
  formatDuration,
  type HeatmapMode,
} from "@/lib/usage-format";

/** Color ramp (empty → most). Warm brown/orange to match the design. */
const HEAT_COLORS = ["rgba(125,125,125,0.10)", "#efd9c2", "#e0b487", "#c98a55", "#a9602f"];

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MODES: HeatmapMode[] = ["daily", "weekly", "cumulative"];

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center px-2 text-center" title={`${label}: ${value}`}>
      <span className="block max-w-full truncate text-lg font-semibold tabular-nums text-foreground">{value}</span>
      <span className="mt-0.5 block max-w-full truncate text-[11px] leading-tight text-muted-foreground">{label}</span>
    </div>
  );
}

export const UsageStatsCard = memo(function UsageStatsCard() {
  const { t, i18n } = useTranslation("settings");
  const lang = i18n.language;
  const { stats, loading, hasLoaded, error, load, refresh } = useUsageStats(true);
  const [mode, setMode] = useState<HeatmapMode>("daily");

  const grid = useMemo(
    () => (stats ? buildHeatmapGrid(stats.days, mode) : null),
    [stats, mode],
  );

  const monthLabel = (month: number) => (lang.startsWith("zh") ? `${month + 1}月` : MONTHS_EN[month]);

  const hasData = stats && stats.days.length > 0;
  const cols = grid?.weeks ?? 53;
  const gridColsStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("account.usage.title")}
        </p>
        <button
          onClick={() => void (hasLoaded ? refresh() : load())}
          disabled={loading}
          className="rounded p-1 text-muted-foreground/70 hover:text-foreground"
          title={t("account.refresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!hasLoaded && (
        <button
          onClick={() => void load()}
          disabled={loading}
          className="w-full rounded-md border border-dashed border-foreground/10 px-3 py-3 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground disabled:opacity-60"
        >
          {t("account.usage.load")}
        </button>
      )}

      {hasLoaded && !stats && loading && (
        <div className="h-24 animate-pulse rounded-xl bg-foreground/[0.04]" />
      )}

      {hasLoaded && !stats && !loading && (
        <p className="rounded-md border border-dashed border-foreground/10 px-3 py-3 text-xs text-muted-foreground">
          {error === "not_configured"
            ? t("account.usage.notConfigured")
            : error
              ? t("account.usage.error")
              : t("account.usage.noData")}
        </p>
      )}

      {stats && (
        <>
          {/* ── Stat row ── */}
          <div className="grid min-w-0 grid-cols-5 divide-x divide-foreground/[0.06] rounded-xl border border-foreground/[0.08] py-3">
            <StatCell value={formatCompactNumber(stats.totalTokens, lang)} label={t("account.usage.totalTokens")} />
            <StatCell value={formatCompactNumber(stats.peakDayTokens, lang)} label={t("account.usage.peakDayTokens")} />
            <StatCell value={formatDuration(stats.longestTaskSec, lang)} label={t("account.usage.longestTask")} />
            <StatCell value={`${stats.currentStreak} ${t("account.usage.days")}`} label={t("account.usage.currentStreak")} />
            <StatCell value={`${stats.longestStreak} ${t("account.usage.days")}`} label={t("account.usage.longestStreak")} />
          </div>

          {/* ── Heatmap (full-width grid, aligned with the stat row) ── */}
          <div>
            <div className="mb-2 flex items-center justify-end gap-3 text-xs">
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={mode === m ? "font-medium text-foreground" : "text-muted-foreground/60 hover:text-foreground"}
                >
                  {t(`account.usage.${m}`)}
                </button>
              ))}
            </div>

            {hasData && grid ? (
              <div>
                <div className="mb-1 grid gap-[3px] text-[9px] text-muted-foreground" style={gridColsStyle}>
                  {grid.monthLabels.map((lbl) => (
                    <span key={lbl.col} className="whitespace-nowrap" style={{ gridColumnStart: lbl.col + 1 }}>
                      {monthLabel(lbl.month)}
                    </span>
                  ))}
                </div>
                <div className="grid gap-[3px]" style={gridColsStyle}>
                  {grid.cells.map((col, ci) => (
                    <div key={ci} className="flex flex-col gap-[3px]">
                      {col.map((cell, ri) => (
                        <div
                          key={ri}
                          className="aspect-square rounded-[2px]"
                          style={{ backgroundColor: HEAT_COLORS[cell.level] }}
                          title={cell.date ? `${cell.date} · ${formatCompactNumber(cell.tokens, lang)}` : undefined}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-foreground/10 px-3 py-3 text-xs text-muted-foreground">
                {t("account.usage.noData")}
              </p>
            )}

            {stats.truncated && (
              <p className="mt-1.5 text-[10.5px] text-muted-foreground/70">{t("account.usage.truncated")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
});
