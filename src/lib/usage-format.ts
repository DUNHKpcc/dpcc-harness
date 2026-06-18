/**
 * Pure helpers for the Token-activity panel: compact number / duration
 * formatting and heatmap grid construction. Kept dependency-free and pure so
 * they can be unit-tested in isolation.
 */

import type { UsageDayBucket } from "@shared/types/account";

const DAY_MS = 86_400_000;

function isZh(lang: string): boolean {
  return lang.startsWith("zh");
}

/** Drop a trailing ".0" so "55.0亿" renders as "55亿". */
function trimZero(s: string): string {
  return s.replace(/\.0$/, "");
}

/** Compact large numbers: zh → 万/亿, otherwise → k/M/B. */
export function formatCompactNumber(n: number, lang: string): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (isZh(lang)) {
    if (n >= 1e8) return `${trimZero((n / 1e8).toFixed(1))}亿`;
    if (n >= 1e4) return `${trimZero((n / 1e4).toFixed(1))}万`;
    return String(Math.round(n));
  }
  if (n >= 1e9) return `${trimZero((n / 1e9).toFixed(1))}B`;
  if (n >= 1e6) return `${trimZero((n / 1e6).toFixed(1))}M`;
  if (n >= 1e3) return `${trimZero((n / 1e3).toFixed(1))}k`;
  return String(Math.round(n));
}

/** Human duration from seconds. zh → "1 小时 23 分", otherwise → "1h 23m". */
export function formatDuration(sec: number, lang: string): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (isZh(lang)) {
    if (h) return `${h} 小时 ${m} 分`;
    if (m) return `${m} 分 ${s} 秒`;
    return `${s} 秒`;
  }
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Heatmap grid ──

export type HeatmapMode = "daily" | "weekly" | "cumulative";

export interface HeatmapCell {
  /** YYYY-MM-DD, or null for cells beyond today. */
  date: string | null;
  tokens: number;
  count: number;
  /** Value driving the color under the current mode. */
  value: number;
  /** Color bucket 0 (empty) … 4 (most). */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatmapMonthLabel {
  col: number;
  /** 0-based month index. */
  month: number;
}

export interface HeatmapGrid {
  weeks: number;
  /** Outer = week column, inner = 7 weekday rows (row 0 = Sunday). */
  cells: HeatmapCell[][];
  monthLabels: HeatmapMonthLabel[];
}

const WEEKS = 53;

/** Local-calendar day index (days since epoch). Matches the backend's keys. */
function localDayNumber(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Parse a "YYYY-MM-DD" key into its day index (must match backend dayKeyFromNumber). */
function parseDayKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function levelFor(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const lvl = Math.ceil((value / max) * 4);
  return Math.min(4, Math.max(1, lvl)) as 1 | 2 | 3 | 4;
}

/**
 * Build a GitHub-style calendar grid (53 weeks × 7 weekdays) from daily buckets.
 * The grid layout is identical across modes — only each cell's color `value`
 * differs: daily = that day, weekly = its column total, cumulative = running total.
 */
export function buildHeatmapGrid(
  days: UsageDayBucket[],
  mode: HeatmapMode,
  nowMs: number = Date.now(),
): HeatmapGrid {
  const byDay = new Map<number, UsageDayBucket>();
  for (const d of days) byDay.set(parseDayKey(d.date), d);

  const todayNum = localDayNumber(nowMs);
  const todayDow = new Date(todayNum * DAY_MS).getUTCDay();
  const startSunday = todayNum - todayDow - (WEEKS - 1) * 7;

  // Prefix sums for cumulative mode.
  const sortedNums = [...byDay.keys()].sort((a, b) => a - b);
  const prefix = new Map<number, number>();
  let running = 0;
  for (const dn of sortedNums) {
    running += byDay.get(dn)!.tokens;
    prefix.set(dn, running);
  }
  const grandTotal = running;
  const cumulativeUpTo = (dn: number): number => {
    let acc = 0;
    for (const sn of sortedNums) {
      if (sn > dn) break;
      acc = prefix.get(sn)!;
    }
    return acc;
  };

  // Column totals for weekly mode.
  const colTotals: number[] = [];
  for (let col = 0; col < WEEKS; col++) {
    let sum = 0;
    for (let row = 0; row < 7; row++) {
      const dn = startSunday + col * 7 + row;
      if (dn > todayNum) continue;
      sum += byDay.get(dn)?.tokens ?? 0;
    }
    colTotals[col] = sum;
  }

  // Determine the max for the active mode (drives level scaling).
  let max = 0;
  if (mode === "daily") {
    for (const dn of sortedNums) max = Math.max(max, byDay.get(dn)!.tokens);
  } else if (mode === "weekly") {
    max = Math.max(0, ...colTotals);
  } else {
    max = grandTotal;
  }

  const cells: HeatmapCell[][] = [];
  const monthLabels: HeatmapMonthLabel[] = [];
  let lastMonth = -1;

  for (let col = 0; col < WEEKS; col++) {
    const column: HeatmapCell[] = [];
    for (let row = 0; row < 7; row++) {
      const dn = startSunday + col * 7 + row;
      if (dn > todayNum) {
        column.push({ date: null, tokens: 0, count: 0, value: 0, level: 0 });
        continue;
      }
      const bucket = byDay.get(dn);
      const tokens = bucket?.tokens ?? 0;
      const count = bucket?.count ?? 0;
      const value =
        mode === "daily" ? tokens : mode === "weekly" ? colTotals[col] : cumulativeUpTo(dn);
      column.push({
        date: bucket?.date ?? dayKeyFromNumber(dn),
        tokens,
        count,
        value,
        level: levelFor(value, max),
      });
    }
    cells.push(column);

    // Month label when the first (Sunday) cell of a column starts a new month.
    const firstDn = startSunday + col * 7;
    if (firstDn <= todayNum && firstDn >= startSunday) {
      const month = new Date(firstDn * DAY_MS).getUTCMonth();
      if (month !== lastMonth) {
        monthLabels.push({ col, month });
        lastMonth = month;
      }
    }
  }

  return { weeks: WEEKS, cells, monthLabels };
}

function dayKeyFromNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
