import { describe, it, expect } from "vitest";
import {
  formatCompactNumber,
  formatDuration,
  buildHeatmapGrid,
} from "./usage-format";
import type { UsageDayBucket } from "@shared/types/account";

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

describe("formatCompactNumber", () => {
  it("formats Chinese 万/亿", () => {
    expect(formatCompactNumber(5_590_000_000, "zh")).toBe("55.9亿");
    expect(formatCompactNumber(31_000, "zh")).toBe("3.1万");
    expect(formatCompactNumber(900, "zh")).toBe("900");
  });
  it("formats English k/M/B", () => {
    expect(formatCompactNumber(5_590_000_000, "en")).toBe("5.6B");
    expect(formatCompactNumber(3_100_000, "en")).toBe("3.1M");
    expect(formatCompactNumber(31_000, "en")).toBe("31k");
  });
  it("handles zero and trims .0", () => {
    expect(formatCompactNumber(0, "zh")).toBe("0");
    expect(formatCompactNumber(100_000_000, "zh")).toBe("1亿");
    expect(formatCompactNumber(2_000_000, "en")).toBe("2M");
  });
});

describe("formatDuration", () => {
  it("formats hours/minutes in Chinese", () => {
    expect(formatDuration(5000, "zh")).toBe("1 小时 23 分");
    expect(formatDuration(150, "zh")).toBe("2 分 30 秒");
    expect(formatDuration(45, "zh")).toBe("45 秒");
  });
  it("formats hours/minutes in English", () => {
    expect(formatDuration(5000, "en")).toBe("1h 23m");
    expect(formatDuration(45, "en")).toBe("45s");
    expect(formatDuration(-5, "en")).toBe("0s");
  });
});

describe("buildHeatmapGrid", () => {
  const now = Date.now();
  const days: UsageDayBucket[] = [
    { date: keyOf(new Date(now)), tokens: 100, count: 3 },
    { date: keyOf(new Date(now - 10 * DAY_MS)), tokens: 50, count: 1 },
    { date: keyOf(new Date(now - 40 * DAY_MS)), tokens: 200, count: 5 },
  ];

  it("produces a 53×7 grid", () => {
    const g = buildHeatmapGrid(days, "daily", now);
    expect(g.cells).toHaveLength(53);
    for (const col of g.cells) expect(col).toHaveLength(7);
  });

  it("daily mode colors each day by its own tokens", () => {
    const g = buildHeatmapGrid(days, "daily", now);
    const all = g.cells.flat();
    const today = all.find((c) => c.date === keyOf(new Date(now)));
    expect(today?.value).toBe(100);
    expect(today?.level).toBeGreaterThan(0);
    // peak (200) should reach the top level
    const peak = all.find((c) => c.tokens === 200);
    expect(peak?.level).toBe(4);
  });

  it("weekly mode gives every cell in a column the column total", () => {
    const g = buildHeatmapGrid(days, "weekly", now);
    const lastCol = g.cells[52];
    const colTotal = lastCol.reduce((s, c) => s + c.tokens, 0);
    expect(colTotal).toBe(100);
    for (const c of lastCol) if (c.date) expect(c.value).toBe(100);
  });

  it("cumulative mode is monotonically non-decreasing over time", () => {
    const g = buildHeatmapGrid(days, "cumulative", now);
    let prev = 0;
    for (const col of g.cells) {
      for (const cell of col) {
        if (cell.date === null) continue;
        expect(cell.value).toBeGreaterThanOrEqual(prev);
        prev = cell.value;
      }
    }
    expect(prev).toBe(350); // grand total
  });

  it("emits month labels", () => {
    const g = buildHeatmapGrid(days, "daily", now);
    expect(g.monthLabels.length).toBeGreaterThan(0);
    for (const lbl of g.monthLabels) {
      expect(lbl.month).toBeGreaterThanOrEqual(0);
      expect(lbl.month).toBeLessThanOrEqual(11);
    }
  });
});
