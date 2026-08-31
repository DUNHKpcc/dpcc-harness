import { test as base, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

interface UiProfile {
  root: string;
  home: string;
  userData: string;
}

interface ElectronFixtures {
  catalogServerUrl: string;
  electronApp: ElectronApplication;
  page: Page;
  uiProfile: UiProfile;
}

const repoRoot = process.cwd();

function createProfile(): UiProfile {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-playwright-ui-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  return { root, home, userData };
}

function launchArgs(): string[] {
  return [
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    repoRoot,
    ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
  ];
}

export const test = base.extend<ElectronFixtures>({
  catalogServerUrl: async ({}, use) => {
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("cache-control", "no-store");
      if (pathname === "/trending") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end('<a href="/fixture-labs/skills/catalog-skill"><h3>catalog-skill</h3><p>fixture-labs/skills</p><span>1.2K</span></a>');
        return;
      }
      if (pathname === "/servers") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          servers: [{
            server: {
              name: "fixture/mcp",
              title: "Fixture MCP",
              description: "Deterministic Playwright MCP catalog entry.",
              version: "1.0.0",
              remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
            },
          }],
        }));
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Playwright catalog fixture did not bind a TCP port.");
    }
    try {
      await use(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },

  uiProfile: async ({}, use) => {
    const profile = createProfile();
    try {
      await use(profile);
    } finally {
      fs.rmSync(profile.root, { recursive: true, force: true });
    }
  },

  electronApp: async ({ catalogServerUrl, uiProfile }, use, testInfo) => {
    const application = await electron.launch({
      args: launchArgs(),
      env: {
        ...process.env,
        CI: process.env.CI || "true",
        HOME: uiProfile.home,
        USERPROFILE: uiProfile.home,
        XDG_CONFIG_HOME: path.join(uiProfile.home, ".config"),
        XDG_CACHE_HOME: path.join(uiProfile.home, ".cache"),
        XDG_DATA_HOME: path.join(uiProfile.home, ".local", "share"),
        APPDATA: path.join(uiProfile.home, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(uiProfile.home, "AppData", "Local"),
        HARNSS_E2E_MODE: "ui",
        HARNSS_E2E_USER_DATA: uiProfile.userData,
        PCC_DEV_SERVER_URL: "http://127.0.0.1:4173",
        PCC_SKILLS_CATALOG_BASE_URL: catalogServerUrl,
        PCC_MCP_REGISTRY_BASE_URL: catalogServerUrl,
        ELECTRON_ENABLE_LOGGING: "1",
      },
    });

    const processLogs: string[] = [];
    application.process().stdout?.on("data", (chunk) => processLogs.push(String(chunk)));
    application.process().stderr?.on("data", (chunk) => processLogs.push(String(chunk)));

    try {
      await use(application);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus && processLogs.length > 0) {
        await testInfo.attach("electron.log", {
          body: Buffer.from(processLogs.join("").slice(-30_000)),
          contentType: "text/plain",
        });
      }
      await application.close();
    }
  },

  page: async ({ electronApp }, use, testInfo) => {
    const page = await electronApp.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message || String(error)));
    await page.route(
      /^https:\/\/(?:github\.com|avatars\.githubusercontent\.com|raw\.githubusercontent\.com)\//,
      (route) => route.abort(),
    );
    await page.waitForSelector("#root");
    await electronApp.context().tracing.start({ screenshots: true, snapshots: true, sources: true });

    try {
      await use(page);
      expect(pageErrors, "renderer page errors").toEqual([]);
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (failed) {
        const screenshotPath = testInfo.outputPath("failure.png");
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
        if (fs.existsSync(screenshotPath)) {
          await testInfo.attach("failure.png", { path: screenshotPath, contentType: "image/png" });
        }
        const tracePath = testInfo.outputPath("trace.zip");
        await electronApp.context().tracing.stop({ path: tracePath });
        await testInfo.attach("trace.zip", { path: tracePath, contentType: "application/zip" });
      } else {
        await electronApp.context().tracing.stop();
      }
    }
  },
});

export { expect };
