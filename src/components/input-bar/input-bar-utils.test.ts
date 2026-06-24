import { describe, expect, it } from "vitest";
import {
  hasMeaningfulText,
  parseDroppedUrls,
  stripVoicePlaceholderText,
} from "./input-bar-utils";

describe("input-bar voice placeholder handling", () => {
  it("strips blank-audio placeholders from plain text", () => {
    expect(stripVoicePlaceholderText("[BLANK_AUDIO]")).toBe("");
    expect(stripVoicePlaceholderText("hello [BLANK_AUDIO]")).toBe("hello ");
  });

  it("treats blank-audio placeholders as non-meaningful text", () => {
    expect(hasMeaningfulText("[BLANK_AUDIO]")).toBe(false);
    expect(hasMeaningfulText(" [BLANK_AUDIO]\n")).toBe(false);
    expect(hasMeaningfulText("hello [BLANK_AUDIO]")).toBe(true);
  });
});

describe("parseDroppedUrls", () => {
  it("extracts URLs from a multi-line uri-list payload", () => {
    const uriList = "https://example.com/a\r\nhttps://example.com/b";
    expect(parseDroppedUrls(uriList, "")).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("ignores comment lines in uri-list (RFC 2483)", () => {
    const uriList = "# this is a comment\nhttps://example.com/page";
    expect(parseDroppedUrls(uriList, "")).toEqual([
      "https://example.com/page",
    ]);
  });

  it("falls back to text/plain when it parses as a URL", () => {
    expect(parseDroppedUrls("", "https://example.com/x")).toEqual([
      "https://example.com/x",
    ]);
  });

  it("returns [] for non-URL plain text (does NOT promote arbitrary text)", () => {
    expect(parseDroppedUrls("", "just some dragged text")).toEqual([]);
  });

  it("accepts file:// URLs (Finder drag)", () => {
    expect(parseDroppedUrls("file:///tmp/foo.txt", "")).toEqual([
      "file:///tmp/foo.txt",
    ]);
  });

  it("dedupes repeated URLs in uri-list", () => {
    expect(parseDroppedUrls("https://x.com\nhttps://x.com", "")).toEqual([
      "https://x.com",
    ]);
  });

  it("rejects non-http(s)/file protocols (e.g. javascript:)", () => {
    expect(parseDroppedUrls("javascript:alert(1)", "")).toEqual([]);
    expect(parseDroppedUrls("", "javascript:alert(1)")).toEqual([]);
  });
});
