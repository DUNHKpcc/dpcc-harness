import i18n from "@/i18n";

export function toastText(key: string, options?: Record<string, unknown>): string {
  return i18n.t(`common:toasts.${key}`, options);
}
