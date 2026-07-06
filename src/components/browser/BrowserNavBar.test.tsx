import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { BrowserNavBar } from "./BrowserNavBar";

type BrowserNavBarProps = ComponentProps<typeof BrowserNavBar>;

function createProps(overrides: Partial<BrowserNavBarProps> = {}): BrowserNavBarProps {
  return {
    urlInput: "https://example.com",
    onUrlInputChange: vi.fn(),
    showSuggestions: false,
    onShowSuggestionsChange: vi.fn(),
    history: [],
    onNavigate: vi.fn(),
    isSecure: true,
    tabUrl: "https://example.com",
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    canNavigate: true,
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onReloadOrStop: vi.fn(),
    inspectMode: false,
    onToggleInspect: vi.fn(),
    isDevToolsOpen: false,
    onToggleDevTools: vi.fn(),
    colorScheme: "light",
    onToggleColorScheme: vi.fn(),
    ...overrides,
  };
}

describe("BrowserNavBar", () => {
  it("omits the webview DevTools button when disabled for production", () => {
    const markup = renderToStaticMarkup(
      <BrowserNavBar {...createProps({ showDevToolsControl: false })} />,
    );

    expect(markup).not.toContain("Open inspector");
  });

  it("keeps the webview DevTools button available in development", () => {
    const markup = renderToStaticMarkup(
      <BrowserNavBar {...createProps({ showDevToolsControl: true })} />,
    );

    expect(markup).toContain("Open inspector");
  });
});
