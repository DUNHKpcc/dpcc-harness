// ── Attachment types ──

export interface ImageAttachment {
  id: string;
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  fileName?: string;
}

/** Non-image file dropped onto the input bar. Carries the absolute path
 *  (resolved via Electron's webUtils.getPathForFile in preload) so we can
 *  read the content at send-time and inline it into the prompt as a `<file>`
 *  context block — same shape used for @mention file references. */
export interface FileAttachment {
  id: string;
  /** Absolute path on disk. */
  path: string;
  /** Basename used for the chip label. */
  fileName: string;
  /** File size in bytes — shown next to the filename in the chip. */
  size: number;
}

/** Element data captured by the browser inspector (Element Grab feature). */
export interface GrabbedElement {
  id: string;
  /** Page URL where the element was captured */
  url: string;
  tag: string;
  /** Best-effort unique CSS selector path */
  selector: string;
  classes: string[];
  /** Whitelisted attributes (id, href, src, alt, role, aria-label, data-testid, etc.) */
  attributes: Record<string, string>;
  /** innerText truncated to 500 chars */
  textContent: string;
  /** outerHTML truncated to 2000 chars */
  outerHTML: string;
  /** Key computed styles (display, position, color, font-size, etc.) */
  computedStyles: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
}
