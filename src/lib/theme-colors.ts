export const DEFAULT_ACCENT_COLOR = "#d97757";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export type AccentColor = string | null;

export function normalizeAccentColor(value: unknown): AccentColor {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

/** Choose readable text for controls that use the customizable accent color. */
export function getAccentForeground(color: string): string {
  const normalized = normalizeAccentColor(color);
  if (!normalized) return "#1c1917";

  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const linearize = (channel: number) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  );
  const luminance = 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);

  return luminance > 0.179 ? "#1c1917" : "#fffaf5";
}

/** Apply the persisted accent to the CSS variables consumed by the renderer. */
export function applyAccentColor(color: AccentColor): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const normalized = normalizeAccentColor(color);
  if (!normalized) {
    root.style.removeProperty("--theme-accent");
    root.style.removeProperty("--theme-accent-foreground");
    return;
  }

  root.style.setProperty("--theme-accent", normalized);
  root.style.setProperty("--theme-accent-foreground", getAccentForeground(normalized));
}
