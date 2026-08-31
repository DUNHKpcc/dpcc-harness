import path from "node:path";

export interface UiE2EConfig {
  mode: "ui";
  userDataPath: string;
}

/**
 * Isolate Playwright UI runs from the developer's real profile. This mode is
 * intentionally unavailable in packaged builds and does not expose test IPC.
 */
export function readUiE2EConfig(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
): UiE2EConfig | null {
  if (isPackaged || env.HARNSS_E2E_MODE?.trim() !== "ui") return null;

  const userDataPath = env.HARNSS_E2E_USER_DATA?.trim();
  if (!userDataPath) {
    throw new Error("Playwright UI E2E requires HARNSS_E2E_USER_DATA.");
  }

  return {
    mode: "ui",
    userDataPath: path.resolve(userDataPath),
  };
}
