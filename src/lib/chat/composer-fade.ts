import type { CSSProperties } from "react";

export const CHAT_COMPOSER_FADE_PX = 32;
const CHAT_COMPOSER_CLEARANCE_PX = 24;
const CHAT_BOTTOM_PADDING_PX = 144;
const CHAT_EXTRA_BOTTOM_PADDING_PX = 280;

/** Protect the entire floating composer, independent of theme/glass opacity. */
export function getChatComposerLayout(composerHeight: number, extraBottomPadding = false): {
  bottomPadding: number;
  scrollStyle: CSSProperties;
} {
  const fallbackPadding = extraBottomPadding ? CHAT_EXTRA_BOTTOM_PADDING_PX : CHAT_BOTTOM_PADDING_PX;
  if (!Number.isFinite(composerHeight) || composerHeight <= 0) {
    return { bottomPadding: fallbackPadding, scrollStyle: {} };
  }

  const inset = Math.ceil(composerHeight);
  const fadeStart = inset + CHAT_COMPOSER_FADE_PX;
  const maskImage = `linear-gradient(to bottom, #000 0, #000 calc(100% - ${fadeStart}px), transparent calc(100% - ${inset}px), transparent 100%)`;
  return {
    bottomPadding: Math.max(fallbackPadding, fadeStart + CHAT_COMPOSER_CLEARANCE_PX),
    scrollStyle: {
      maskImage,
      WebkitMaskImage: maskImage,
      // Masks do not suppress hit testing. Clip the fully hidden region so
      // invisible message actions cannot intercept clicks around the composer.
      clipPath: `inset(0 0 ${inset}px 0)`,
    },
  };
}
