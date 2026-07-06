export function shouldShowBrowserDevTools(isDev = import.meta.env.DEV): boolean {
  return isDev;
}
