import type { AppSettings } from "@shared/types/settings";
import i18n from "@/i18n";
import { toast } from "sonner";

export function isSettingsSetFailure(result: unknown): result is { error: string } {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof (result as { error?: unknown }).error === "string" &&
    (result as { error: string }).error.trim().length > 0
  );
}

export function assertSettingsSetOk(result: unknown): void {
  if (isSettingsSetFailure(result)) {
    throw new Error(result.error);
  }
}

export async function setAppSettingsChecked(patch: Partial<AppSettings>): Promise<void> {
  assertSettingsSetOk(await window.claude.settings.set(patch));
}

export function reportSettingsSaveFailure(error: unknown): void {
  console.warn("[settings] Failed to persist app settings", error);
  toast.error(i18n.t("settings:saveFailed"));
}
