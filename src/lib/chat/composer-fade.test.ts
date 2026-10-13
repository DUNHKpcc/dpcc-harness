import { describe, expect, it } from "vitest";
import { CHAT_COMPOSER_FADE_PX, getChatComposerLayout } from "./composer-fade";

describe("floating composer fade boundary", () => {
  it("keeps the previous fallback before a composer has been measured", () => {
    expect(getChatComposerLayout(0)).toEqual({ bottomPadding: 144, scrollStyle: {} });
    expect(getChatComposerLayout(0, true)).toEqual({ bottomPadding: 280, scrollStyle: {} });
    for (const invalid of [-1, NaN, Infinity]) {
      expect(getChatComposerLayout(invalid).scrollStyle).toEqual({});
    }
  });

  it("fully hides and excludes pointer hits under the composer, with a short fade above it", () => {
    const layout = getChatComposerLayout(160);
    expect(layout.scrollStyle.maskImage).toContain(`calc(100% - ${160 + CHAT_COMPOSER_FADE_PX}px)`);
    expect(layout.scrollStyle.maskImage).toContain("transparent calc(100% - 160px), transparent 100%");
    expect(layout.scrollStyle.WebkitMaskImage).toBe(layout.scrollStyle.maskImage);
    expect(layout.scrollStyle.clipPath).toBe("inset(0 0 160px 0)");
    expect(layout.bottomPadding).toBe(216);
  });

  it("grows the protection and leaves the last message actions outside the fade", () => {
    for (const composerHeight of [120, 240, 400]) {
      const layout = getChatComposerLayout(composerHeight);
      expect(layout.scrollStyle.clipPath).toBe(`inset(0 0 ${composerHeight}px 0)`);
      expect(layout.bottomPadding).toBeGreaterThan(composerHeight + CHAT_COMPOSER_FADE_PX);
    }
    expect(getChatComposerLayout(160, true).bottomPadding).toBe(280);
    expect(getChatComposerLayout(400, true).bottomPadding).toBe(456);
  });

  it("rounds fractional compositor heights outward rather than exposing a seam", () => {
    expect(getChatComposerLayout(160.25).scrollStyle.clipPath).toBe("inset(0 0 161px 0)");
    expect(getChatComposerLayout(160.25).bottomPadding).toBe(217);
  });
});
