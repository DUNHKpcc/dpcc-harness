import { app, ipcMain, BrowserWindow, powerMonitor } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo, ProgressInfo } from "electron-updater";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { log } from "./logger";
import { reportError } from "./error-utils";
import { getAppSetting } from "./app-settings";
import { openExternalUrl } from "./open-external";
import type { UpdateSource } from "@shared/types/settings";
import { onSettingsChanged } from "../ipc/settings";

const execFileAsync = promisify(execFile);

// ── Update feed sources ──
// The official GitHub source (mirrors electron-builder.config.js `publish`).
const GITHUB_OWNER = "DUNHKpcc";
const GITHUB_REPO = "dpcc-harness";
// Self-hosted domestic mirror (dpccgaming.xyz). A directory served over HTTPS
// containing the channel files (latest.yml / latest-mac.yml) and the installer
// artifacts, laid out like a GitHub release's assets. Mirrors only the mainstream
// builds (Windows x64, macOS arm64) for the latest version; users on other arches
// should keep the GitHub source.
const UPDATE_MIRROR_URL = "https://dpccgaming.xyz/harnss/updates/";

// The user's requested source, the source the live feed URL currently points at,
// and a session-only override set when the primary feed is unreachable and we
// auto-fall back to the other one (so we stop re-probing the dead feed).
let requestedFeedSource: UpdateSource | null = null;
let currentFeedSource: UpdateSource | null = null;
let sessionFeedOverride: UpdateSource | null = null;
// Set once every feed has failed within a single check cycle. Stops the automatic
// startup/periodic/focus/resume checks from hammering an unreachable network.
// Re-armed by an explicit manual check or a feed-source/channel change.
let updateChecksSuspended = false;

const mirrorUsable = (): boolean => /^https?:\/\//.test(UPDATE_MIRROR_URL);

/**
 * The ordered feed sources to try for one check: the preferred source first, then
 * the other as an automatic fallback (e.g. GitHub blocked in CN → domestic
 * mirror). Drops the mirror when its URL is still a placeholder.
 */
function feedCandidates(preferred: UpdateSource): UpdateSource[] {
  if (!mirrorUsable()) return ["github"];
  return preferred === "mirror" ? ["mirror", "github"] : ["github", "mirror"];
}

/** Point electron-updater at a specific source's URL. Returns the resolved source. */
function setLiveFeed(source: UpdateSource): UpdateSource {
  const useMirror = source === "mirror" && mirrorUsable();
  if (useMirror) {
    autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_MIRROR_URL });
  } else {
    autoUpdater.setFeedURL({ provider: "github", owner: GITHUB_OWNER, repo: GITHUB_REPO });
  }
  currentFeedSource = useMirror ? "mirror" : "github";
  return currentFeedSource;
}

/**
 * Apply the user's chosen feed (from settings). No-op when unchanged. The actual
 * per-check feed switching (including the unreachable-feed fallback) happens in
 * checkForUpdates.
 */
function applyFeedSource(source: UpdateSource): void {
  if (source === requestedFeedSource) return;
  requestedFeedSource = source;
  const resolved = setLiveFeed(source);
  log(
    "UPDATER",
    resolved === "mirror"
      ? `Feed source set to mirror: ${UPDATE_MIRROR_URL}`
      : `Feed source set to github (${GITHUB_OWNER}/${GITHUB_REPO})`,
  );
}

/** Best-effort manual-download page for the active feed source. */
function manualDownloadUrl(): string {
  if (currentFeedSource === "mirror") return UPDATE_MIRROR_URL;
  return lastDownloadedVersion
    ? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${lastDownloadedVersion}`
    : `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing internal MacUpdater state for diagnostics
type MacUpdaterInternal = { squirrelDownloadedUpdate?: boolean };
type UpdateInstallErrorCode = "download-missing" | "manual-install-failed";

// Track the latest downloaded update version for manual macOS install
let lastDownloadedVersion: string | null = null;

// Flag to prevent window-all-closed from calling app.quit() while quitAndInstall() is
// managing the quit lifecycle (Squirrel.Mac needs control of the process on macOS).
let installingUpdate = false;
let updateCheckInFlight = false;
let lastUpdateCheckAt = 0;

export const STARTUP_UPDATE_CHECK_DELAY_MS = 5_000;
export const PERIODIC_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
export const ACTIVE_UPDATE_CHECK_MIN_INTERVAL_MS = 30 * 60 * 1_000;

export function getIsInstallingUpdate(): boolean {
  return installingUpdate;
}

function isCurrentVersionPreRelease(): boolean {
  return app.getVersion().includes("-");
}

function syncUpdateChannelPreferences(allowPrereleaseUpdates: boolean): void {
  autoUpdater.allowPrerelease = allowPrereleaseUpdates;
  autoUpdater.allowDowngrade = !allowPrereleaseUpdates && isCurrentVersionPreRelease();
}

function sendInstallError(
  getMainWindow: () => BrowserWindow | null,
  code: UpdateInstallErrorCode,
  message: string,
): void {
  const win = getMainWindow();
  win?.webContents.send("updater:install-error", { code, message });
}

/** @internal Exported for testing. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Reasons that represent an explicit user intent to (re)check: they clear any
 * session fallback and re-arm checks suspended after a total failure.
 */
function isExplicitCheck(reason: string): boolean {
  return reason === "manual" || reason === "switch-feed-source" || reason === "switch-to-stable";
}

/** @internal Exported for testing. */
export async function checkForUpdates(reason: string): Promise<void> {
  if (updateCheckInFlight) {
    log("UPDATER_DEBUG", `Skipping "${reason}" check; update check already in progress`);
    return;
  }

  if (isExplicitCheck(reason)) {
    // The user explicitly asked — retry from their preferred feed.
    updateChecksSuspended = false;
    sessionFeedOverride = null;
  } else if (updateChecksSuspended) {
    log("UPDATER_DEBUG", `Skipping "${reason}" check; auto-updates suspended after every feed was unreachable`);
    return;
  }

  updateCheckInFlight = true;
  lastUpdateCheckAt = Date.now();

  const preferred = sessionFeedOverride ?? requestedFeedSource ?? getAppSetting("updateSource");
  const candidates = feedCandidates(preferred);

  try {
    log("UPDATER_DEBUG", `Running update check (${reason})`);
    let lastErr: unknown = null;
    for (const source of candidates) {
      setLiveFeed(source);
      try {
        await autoUpdater.checkForUpdates();
        if (source !== preferred) {
          // The primary feed was unreachable. Stick to the working source for the
          // rest of the session and leave the live feed pointed here so a
          // follow-up downloadUpdate() hits the same source.
          sessionFeedOverride = source;
          log("UPDATER", `Primary feed unreachable; using fallback source "${source}" for this session`);
        }
        return;
      } catch (err) {
        lastErr = err;
        log("UPDATER_WARN", `Update check failed on source "${source}": ${getErrorMessage(err)}`);
      }
    }

    // Every candidate failed — record it once, then stop auto-retrying so we don't
    // keep hammering an unreachable network on every focus/resume/interval.
    reportError("UPDATER_ERR", lastErr, { reason, sources: candidates.join(",") });
    if (candidates.length > 1) {
      updateChecksSuspended = true;
      log("UPDATER", "All update feeds unreachable — suspending automatic checks until a manual retry");
    }
    setLiveFeed(preferred);
  } finally {
    updateCheckInFlight = false;
  }
}

/** @internal Exported for testing. */
export function maybeCheckForUpdates(reason: string, minIntervalMs: number): void {
  const elapsedMs = Date.now() - lastUpdateCheckAt;
  if (elapsedMs < minIntervalMs) return;
  void checkForUpdates(reason);
}

export function initAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
): void {
  if (!app.isPackaged) return;

  autoUpdater.logger = {
    info: (msg: unknown) => log("UPDATER", String(msg)),
    warn: (msg: unknown) => log("UPDATER_WARN", String(msg)),
    error: (msg: unknown) => log("UPDATER_ERR", String(msg)),
    debug: (msg: unknown) => log("UPDATER_DEBUG", String(msg)),
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Read persisted preferences (defaults: stable channel, github feed)
  syncUpdateChannelPreferences(getAppSetting("allowPrereleaseUpdates"));
  applyFeedSource(getAppSetting("updateSource"));

  // React to setting changes at runtime (e.g. user toggles in Settings UI)
  onSettingsChanged((settings) => {
    syncUpdateChannelPreferences(settings.allowPrereleaseUpdates);
    log(
      "UPDATER",
      `allowPrerelease changed to ${settings.allowPrereleaseUpdates}; allowDowngrade=${autoUpdater.allowDowngrade}`,
    );

    // Switching the feed source invalidates any in-flight/staged download — re-check
    // against the new source so the user sees the right version immediately.
    const sourceChanged = requestedFeedSource !== settings.updateSource;
    applyFeedSource(settings.updateSource);

    if (sourceChanged) {
      void checkForUpdates("switch-feed-source");
    } else if (!settings.allowPrereleaseUpdates && isCurrentVersionPreRelease()) {
      void checkForUpdates("switch-to-stable");
    }
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    log("UPDATER", `Update available: ${info.version}`);
    const win = getMainWindow();
    win?.webContents.send("updater:update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("update-not-available", () => {
    log("UPDATER", "No update available");
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    const win = getMainWindow();
    win?.webContents.send("updater:download-progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    log("UPDATER", `Update downloaded: ${info.version}`);
    lastDownloadedVersion = info.version;
    const win = getMainWindow();
    win?.webContents.send("updater:update-downloaded", {
      version: info.version,
    });
  });

  autoUpdater.on("error", (err: Error) => {
    // Errors during a check cycle are expected when a feed is unreachable and are
    // already handled (with fallback) by checkForUpdates — log only, don't spam
    // exception capture. Errors outside a check (e.g. during download) are real.
    if (updateCheckInFlight) {
      log("UPDATER_WARN", `autoUpdater error during check: ${err.message}`);
      return;
    }
    reportError("UPDATER_ERR", err);
  });

  // IPC handlers for renderer
  ipcMain.handle("updater:download", () => autoUpdater.downloadUpdate());
  ipcMain.handle("updater:install", async () => {
    if (process.platform === "darwin") {
      // squirrelDownloadedUpdate is a macOS-only property on MacUpdater — doesn't exist on
      // NsisUpdater (Windows) or AppImageUpdater (Linux), so only check it on macOS.
      const squirrelReady = (autoUpdater as unknown as MacUpdaterInternal).squirrelDownloadedUpdate;
      log("UPDATER", `Install requested (macOS, squirrelReady=${squirrelReady})`);

      if (!squirrelReady) {
        // Squirrel.Mac requires code-signed apps — unsigned builds always fail verification.
        // Bypass Squirrel entirely: extract the downloaded ZIP and swap the .app bundle manually.
        log("UPDATER", "Squirrel.Mac unavailable (unsigned app), attempting manual install");
        try {
          await manualMacInstall();
        } catch (err) {
          reportError("UPDATER_ERR", err, { context: "manual-mac-install" });
          // Last resort: open the active source's download page for manual install
          void openExternalUrl(manualDownloadUrl(), { logLabel: "UPDATER_OPEN_EXTERNAL_BLOCKED" });
          sendInstallError(
            getMainWindow,
            "manual-install-failed",
            "Automatic install failed. The download page has been opened — please install manually.",
          );
          // Drop the cached download — it failed to install, so free the disk and
          // force a clean re-download on the next attempt.
          deleteDownloadedUpdate();
        }
        return;
      }
    } else {
      log("UPDATER", `Install requested (${process.platform})`);

      // On Windows/Linux, there's no squirrelDownloadedUpdate flag — just verify the
      // update-downloaded event has fired (tracked by lastDownloadedVersion).
      if (!lastDownloadedVersion) {
        log("UPDATER_ERR", "Cannot install: no update has been downloaded yet");
        sendInstallError(
          getMainWindow,
          "download-missing",
          "Update failed to download. Try downloading the latest version manually.",
        );
        return;
      }
    }

    installingUpdate = true;
    // Force-close all windows so the updater has clean control of the quit lifecycle.
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy(); // destroy() skips beforeunload/close events — immediate teardown
    }
    // Defer to next tick so window destruction propagates before the installer takes over
    setImmediate(() => {
      log("UPDATER", "Calling quitAndInstall()");
      autoUpdater.quitAndInstall();
    });
  });
  ipcMain.handle("updater:check", () => checkForUpdates("manual"));
  ipcMain.handle("updater:current-version", () => app.getVersion());

  // Check 5s after startup, then every 4 hours
  setTimeout(() => {
    void checkForUpdates("startup");
  }, STARTUP_UPDATE_CHECK_DELAY_MS);

  setInterval(
    () => {
      void checkForUpdates("periodic");
    },
    PERIODIC_UPDATE_CHECK_INTERVAL_MS,
  );

  powerMonitor.on("resume", () => {
    maybeCheckForUpdates("resume", ACTIVE_UPDATE_CHECK_MIN_INTERVAL_MS);
  });

  app.on("browser-window-focus", () => {
    maybeCheckForUpdates("focus", ACTIVE_UPDATE_CHECK_MIN_INTERVAL_MS);
  });
}

// ---------------------------------------------------------------------------
// Manual macOS install — bypasses Squirrel.Mac for unsigned apps.
//
// macOS doesn't lock running executables (unlike Windows), so we can safely
// swap the .app bundle while the process is alive. The OS keeps the old binary
// in memory via inode references until all file descriptors close.
//
// Flow: extract ZIP → rename old .app → copy new .app → strip quarantine → relaunch
// ---------------------------------------------------------------------------

/**
 * Find the downloaded update ZIP in electron-updater's cache directory.
 * Falls back to glob-matching if the exact version-based name isn't found.
 */
/** @internal Exported for testing. */
export function findUpdateZip(): string | null {
  // electron-updater stores downloads in ~/Library/Caches/pcc-agent-updater/pending/
  // app.getPath("appData") = ~/Library/Application Support, so go up one to ~/Library/
  const cacheDir = path.join(path.dirname(app.getPath("appData")), "Caches", "pcc-agent-updater", "pending");
  if (!fs.existsSync(cacheDir)) return null;

  // Try exact match first (e.g. PccAgent-0.6.1-arm64-mac.zip)
  if (lastDownloadedVersion) {
    const entries = fs.readdirSync(cacheDir);
    const match = entries.find(
      (e) => e.endsWith("-mac.zip") && e.includes(lastDownloadedVersion!),
    );
    if (match) return path.join(cacheDir, match);
  }

  // Fallback: pick the newest non-temp .zip
  const entries = fs.readdirSync(cacheDir)
    .filter((e) => e.endsWith("-mac.zip") && !e.startsWith("temp-"))
    .map((e) => ({ name: e, mtime: fs.statSync(path.join(cacheDir, e)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return entries.length > 0 ? path.join(cacheDir, entries[0].name) : null;
}

/**
 * Delete the downloaded update artifact from electron-updater's cache after a
 * failed install. Without this the ~100–200 MB download lingers in
 * ~/Library/Caches/pcc-agent-updater/pending/ until the next update overwrites
 * it. Also resets lastDownloadedVersion so a retry re-downloads cleanly.
 */
function deleteDownloadedUpdate(): void {
  try {
    const zipPath = findUpdateZip();
    if (zipPath && fs.existsSync(zipPath)) {
      fs.rmSync(zipPath, { force: true });
      log("UPDATER", `Deleted cached update after failed install: ${path.basename(zipPath)}`);
      // Remove the .blockmap sidecar electron-updater writes alongside the download.
      const blockmap = `${zipPath}.blockmap`;
      if (fs.existsSync(blockmap)) fs.rmSync(blockmap, { force: true });
    }
  } catch (err) {
    reportError("UPDATER_ERR", err, { context: "delete-downloaded-update" });
  } finally {
    lastDownloadedVersion = null;
  }
}

/**
 * @internal Exported for testing — resets module-level state between test runs.
 * Not needed in production since the module is loaded once per process.
 */
export function __resetForTesting(): void {
  lastDownloadedVersion = null;
  installingUpdate = false;
  updateCheckInFlight = false;
  lastUpdateCheckAt = 0;
  requestedFeedSource = null;
  currentFeedSource = null;
  sessionFeedOverride = null;
  updateChecksSuspended = false;
}

async function manualMacInstall(): Promise<void> {
  const zipPath = findUpdateZip();
  if (!zipPath) throw new Error("Downloaded update ZIP not found in cache");
  log("UPDATER", `Manual install: using ZIP at ${zipPath}`);

  // Resolve the current .app bundle path from the running executable
  // e.g. /Applications/PccAgent.app/Contents/MacOS/PccAgent → /Applications/PccAgent.app
  const exePath = app.getPath("exe");
  const appBundleMatch = exePath.match(/^(.+?\.app)\//);
  if (!appBundleMatch) throw new Error(`Cannot determine .app bundle from exe path: ${exePath}`);
  const appBundlePath = appBundleMatch[1];
  const appParentDir = path.dirname(appBundlePath);

  // Sanity check: make sure we can write to the app's parent directory
  try {
    fs.accessSync(appParentDir, fs.constants.W_OK);
  } catch {
    throw new Error(`No write permission to ${appParentDir} — install the app to a writable location`);
  }

  const tmpDir = path.join(app.getPath("temp"), `pcc-agent-update-${Date.now()}`);
  const backupPath = `${appBundlePath}.old`;

  try {
    // 1. Extract the ZIP using ditto (preserves macOS metadata, symlinks, xattrs)
    log("UPDATER", `Extracting ${path.basename(zipPath)} to ${tmpDir}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    await execFileAsync("ditto", ["-xk", zipPath, tmpDir]);

    // 2. Find the .app bundle inside the extracted directory
    const entries = fs.readdirSync(tmpDir);
    const appEntry = entries.find((e) => e.endsWith(".app"));
    if (!appEntry) throw new Error("No .app bundle found in update ZIP");
    const newAppPath = path.join(tmpDir, appEntry);

    // 3. Strip quarantine xattr so macOS doesn't block the unsigned app on first launch
    await execFileAsync("xattr", ["-cr", newAppPath]).catch(() => {
      /* non-fatal — xattr may not exist */
    });

    // 4. Atomic-ish swap: rename old .app → .old, copy new .app, delete .old
    //    If the copy fails, we roll back by renaming .old back.
    log("UPDATER", `Swapping ${appBundlePath}`);
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
    fs.renameSync(appBundlePath, backupPath);

    try {
      await execFileAsync("ditto", [newAppPath, appBundlePath]);
    } catch (copyErr) {
      // Rollback: restore the original app
      log("UPDATER_ERR", "Copy failed, rolling back");
      fs.renameSync(backupPath, appBundlePath);
      throw copyErr;
    }

    // Swap succeeded — clean up backup and temp files
    fs.rmSync(backupPath, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });

    log("UPDATER", "Manual install succeeded, relaunching");
    installingUpdate = true;

    // Close all windows then relaunch from the new binary
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy();
    }
    app.relaunch();
    app.exit(0);
  } catch (err) {
    // Clean up temp dir on failure
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}
