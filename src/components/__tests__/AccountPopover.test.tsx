import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

describe("sidebar account popover", () => {
  it("tracks the measured sidebar footer width instead of using a fixed tray width", () => {
    const sidebar = fs.readFileSync(path.join(repoRoot, "src/components/AppSidebar.tsx"), "utf8");
    const popover = fs.readFileSync(path.join(repoRoot, "src/components/AccountPopover.tsx"), "utf8");

    expect(sidebar).toContain("const footerContentRef = useRef<HTMLDivElement>(null)");
    expect(sidebar).toContain("const observer = new ResizeObserver(updateFooterWidth)");
    expect(sidebar).toContain("availableWidth={footerContentWidth}");
    expect(popover).toContain("style={availableWidth === undefined ? undefined : { width: availableWidth }}");
    expect(popover).toContain("max-w-[var(--radix-popover-content-available-width)]");
  });
});
