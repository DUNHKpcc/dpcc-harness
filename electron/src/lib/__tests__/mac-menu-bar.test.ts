import { describe, expect, it, vi } from "vitest";
import type { AccountAuthSnapshot } from "@shared/types/account-auth";
import {
  buildMacMenuBarTemplate,
  buildMacTrayTemplateBitmap,
  type MacMenuBarActions,
  type MacMenuBarData,
} from "../mac-menu-bar";

function connectedSnapshot(): AccountAuthSnapshot {
  return {
    status: "connected",
    issuer: "https://api.dpccgaming.xyz",
    clientId: "pcc-agent",
    deviceName: "Test Mac",
    account: {
      displayName: "DPCC User",
      maskedEmail: "d***@example.com",
      subscriptionState: "active",
    },
    expiresAt: Date.now() + 86_400_000,
    scopes: [],
    legacyManual: false,
  };
}

function menuActions(): MacMenuBarActions {
  return {
    newChat: vi.fn(),
    openSettings: vi.fn(),
    openSession: vi.fn(),
    recharge: vi.fn(),
    setOpenAtLogin: vi.fn(),
    showApp: vi.fn(),
    quit: vi.fn(),
  };
}

function menuData(overrides: Partial<MacMenuBarData> = {}): MacMenuBarData {
  return {
    auth: connectedSnapshot(),
    overview: null,
    recentSessions: [],
    activeAgentCount: 0,
    activeTerminalCount: 0,
    openAtLogin: false,
    loginItemSupported: true,
    locale: "en-US",
    supportsHeaders: true,
    ...overrides,
  };
}

describe("macOS menu bar", () => {
  it("uses account subscription-state fallback when the overview is unavailable", () => {
    const template = buildMacMenuBarTemplate(menuData(), menuActions());

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Subscription: Current plan", sublabel: "Active" }),
      expect.objectContaining({ label: "Quota: Unavailable" }),
    ]));
  });

  it("renders quota as a compact horizontal progress row", () => {
    const template = buildMacMenuBarTemplate(menuData({
      overview: {
        balance: { totalUsd: 100, usedUsd: 63, remainingUsd: 37, unlimited: false },
        subscription: { state: "active", expiresAt: null, items: [] },
      },
    }), menuActions());

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Quota: $37.00 available",
        sublabel: "━━━━────────  37%",
      }),
    ]));
  });

  it("normalizes recent titles for native menu rows", () => {
    const template = buildMacMenuBarTemplate(menuData({
      recentSessions: [{
        id: "session-1",
        projectId: "project-1",
        title: "  A recent\nconversation  ",
        createdAt: 0,
        lastMessageAt: new Date("2026-08-14T12:00:00Z").getTime(),
        engine: "codex",
      }],
    }), menuActions());

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "A recent conversation",
        sublabel: expect.stringContaining("Codex ·"),
      }),
    ]));
  });
});

describe("macOS tray template bitmap", () => {
  it("uses the light logo mark as alpha instead of the opaque background", () => {
    const source = Buffer.alloc(4 * 4 * 4);
    for (let pixel = 0; pixel < 16; pixel += 1) source[pixel * 4 + 3] = 255;
    const markPixel = (1 * 4 + 1) * 4;
    source[markPixel] = 255;
    source[markPixel + 1] = 255;
    source[markPixel + 2] = 255;

    const result = buildMacTrayTemplateBitmap(source, 4, 4);

    expect(result).not.toBeNull();
    const alphaValues = Array.from(result ?? []).filter((_value, index) => index % 4 === 3);
    expect(alphaValues.filter((value) => value > 0).length).toBeGreaterThan(0);
    expect(alphaValues.filter((value) => value > 0).length).toBeLessThan(16);
    expect(Array.from(result ?? []).filter((_value, index) => index % 4 !== 3)).not.toContain(255);
  });

  it("area-samples a high-resolution mark into a smooth Retina template", () => {
    const source = Buffer.alloc(8 * 8 * 4);
    for (let pixel = 0; pixel < 64; pixel += 1) source[pixel * 4 + 3] = 255;
    for (let y = 1; y < 7; y += 1) {
      for (let x = 1; x <= y; x += 1) {
        const pixel = (y * 8 + x) * 4;
        source[pixel] = 255;
        source[pixel + 1] = 255;
        source[pixel + 2] = 255;
      }
    }

    const result = buildMacTrayTemplateBitmap(source, 8, 8, 4, 4);
    const alphaValues = Array.from(result ?? []).filter((_value, index) => index % 4 === 3);

    expect(result).toHaveLength(4 * 4 * 4);
    expect(alphaValues.some((value) => value > 0 && value < 255)).toBe(true);
  });
});
