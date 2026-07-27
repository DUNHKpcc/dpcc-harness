import type { BrowserWindow, WebContents } from "electron";

export const PACKAGE_SMOKE_CHECK_ARG = "--package-smoke-check";

export interface PackageSmokeCheckResult {
  asarLogoUrl: string;
  extraResourcesLogoUrl: string;
  terminalShellOptionsLoaded: boolean;
  terminalShellOptionCount: number;
  terminalAutoShellPath: string;
  welcomeReplayTriggered: boolean;
}

export function isPackageSmokeCheckRequested(argv = process.argv): boolean {
  return argv.includes(PACKAGE_SMOKE_CHECK_ARG);
}

function waitForRendererLoad(webContents: WebContents, timeoutMs = 30_000): Promise<void> {
  if (!webContents.isLoadingMainFrame()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      webContents.removeListener("did-finish-load", onLoad);
      webContents.removeListener("did-fail-load", onFail);
      webContents.removeListener("render-process-gone", onGone);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
    ) => {
      cleanup();
      reject(new Error(`Renderer failed to load (${errorCode}): ${errorDescription}`));
    };
    const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
      cleanup();
      reject(new Error(`Renderer exited during smoke check: ${details.reason}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Renderer did not finish loading within ${timeoutMs}ms`));
    }, timeoutMs);

    webContents.once("did-finish-load", onLoad);
    webContents.once("did-fail-load", onFail);
    webContents.once("render-process-gone", onGone);
  });
}

export async function runPackageSmokeCheck(
  window: BrowserWindow,
): Promise<PackageSmokeCheckResult> {
  const webContents = window.webContents;
  await waitForRendererLoad(webContents);

  await webContents.executeJavaScript(
    `localStorage.setItem("pcc-agent-welcome-completed", "true")`,
    true,
  );
  webContents.reload();
  await waitForRendererLoad(webContents);

  return webContents.executeJavaScript(`
    (async () => {
      const waitFor = async (readValue, label, timeoutMs = 15000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = readValue();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for " + label);
      };

      const waitForImage = async (image, label) => {
        await waitFor(() => image.complete && image.naturalWidth > 0, label);
        try {
          await image.decode();
        } catch {
          if (!image.complete || image.naturalWidth === 0) {
            throw new Error(label + " could not be decoded");
          }
        }
      };

      const logo = await waitFor(
        () => document.querySelector('[data-pcc-agent-logo]'),
        "PccAgentLogo",
      );
      await waitForImage(logo, "PccAgentLogo from app.asar");
      const asarLogoUrl = logo.currentSrc || logo.src;

      const extraResourcesSrc = logo.getAttribute("data-extra-resources-src");
      if (!extraResourcesSrc) {
        throw new Error("PccAgentLogo is missing its extraResources fallback");
      }
      logo.src = extraResourcesSrc;
      await waitForImage(logo, "PccAgentLogo from extraResources");
      const extraResourcesLogoUrl = logo.currentSrc || logo.src;

      const accountMenu = await waitFor(
        () => document.querySelector('[data-package-smoke="account-menu"]'),
        "account menu",
      );
      accountMenu.click();

      const openSettings = await waitFor(
        () => document.querySelector('[data-package-smoke="open-settings"]'),
        "settings command",
      );
      openSettings.click();

      const generalSettings = await waitFor(
        () => document.querySelector('[data-settings-section="general"]'),
        "General settings navigation",
      );
      generalSettings.click();

      const terminalShellSetting = await waitFor(
        () => document.querySelector('[data-package-smoke="terminal-shell-setting"]'),
        "Integrated terminal shell setting",
      );
      if (!terminalShellSetting.querySelector("button")) {
        throw new Error("Integrated terminal shell setting is missing its selector");
      }

      const shellOptionsApi = window.claude?.terminal?.shellOptions;
      if (typeof shellOptionsApi !== "function") {
        throw new Error("Preload is missing terminal.shellOptions");
      }
      const shellOptionsResult = await shellOptionsApi();
      if (shellOptionsResult.error) {
        throw new Error("terminal.shellOptions failed: " + shellOptionsResult.error);
      }
      const terminalShellOptions = shellOptionsResult.options;
      if (!Array.isArray(terminalShellOptions) || terminalShellOptions.length < 2) {
        throw new Error("terminal.shellOptions returned no platform shell options");
      }
      const autoShell = terminalShellOptions.find((option) => option.shell === "auto");
      if (!autoShell?.available || typeof autoShell.path !== "string" || !autoShell.path) {
        throw new Error("terminal.shellOptions did not resolve the automatic shell");
      }

      const advancedSettings = await waitFor(
        () => document.querySelector('[data-settings-section="advanced"]'),
        "Advanced settings navigation",
      );
      advancedSettings.click();

      const replayWelcome = await waitFor(
        () => document.querySelector('[data-package-smoke="replay-welcome"]'),
        "Replay welcome command",
      );
      if (localStorage.getItem("pcc-agent-welcome-completed") !== "true") {
        throw new Error("Welcome completion state was not seeded before replay");
      }
      replayWelcome.click();

      await waitFor(
        () => document.querySelector('[data-package-smoke="welcome-wizard"]'),
        "WelcomeWizard after replay",
      );
      if (localStorage.getItem("pcc-agent-welcome-completed") !== null) {
        throw new Error("Replay welcome did not clear the completion state");
      }

      return {
        asarLogoUrl,
        extraResourcesLogoUrl,
        terminalShellOptionsLoaded: true,
        terminalShellOptionCount: terminalShellOptions.length,
        terminalAutoShellPath: autoShell.path,
        welcomeReplayTriggered: true,
      };
    })()
  `, true) as Promise<PackageSmokeCheckResult>;
}
