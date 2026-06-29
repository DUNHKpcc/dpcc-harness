import { describe, expect, it } from "vitest";
import { projectSidebarArrowX } from "../welcome-screen-arrow";

describe("projectSidebarArrowX", () => {
  it("preserves the original overshoot when there is room on the right", () => {
    const x = projectSidebarArrowX({
      offset: 772,
      tipX: 18,
      tailX: 660,
      usableWidth: 900,
      baseSpan: 642,
      maxOffset: 772,
      rightInset: 24,
    });

    expect(x).toBeCloseTo(790, 6);
  });

  it("compresses overshoot to stay inside the available width", () => {
    const x = projectSidebarArrowX({
      offset: 772,
      tipX: 18,
      tailX: 960,
      usableWidth: 1000,
      baseSpan: 642,
      maxOffset: 772,
      rightInset: 24,
    });

    expect(x).toBe(976);
  });

  it("keeps the tail position unchanged for the base span endpoint", () => {
    const x = projectSidebarArrowX({
      offset: 642,
      tipX: 18,
      tailX: 960,
      usableWidth: 1000,
      baseSpan: 642,
      maxOffset: 772,
      rightInset: 24,
    });

    expect(x).toBe(960);
  });
});
