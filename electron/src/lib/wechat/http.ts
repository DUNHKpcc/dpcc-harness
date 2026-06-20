import { log } from "../logger";

/**
 * Minimal fetch wrapper with per-attempt timeout + bounded retry, tuned for the
 * iLink Bot API. Built on the global `fetch` available in the Electron main
 * process (Node 20+).
 *
 * Abort semantics: an EXTERNAL `signal` (the long-poll deadline) that fires
 * surfaces as an AbortError and is NEVER retried — the caller treats it as a
 * normal long-poll timeout. A per-attempt TIMEOUT (no external abort) is a
 * transient stall and IS retried within the remaining budget, matching the
 * reference. Transient network drops are likewise retried.
 */
export interface FetchWithRetryOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Request body — always a JSON string for the iLink API. */
  body?: string;
  /** External abort signal (e.g. long-poll deadline). */
  signal?: AbortSignal;
  /** Per-attempt timeout in ms. */
  timeoutMs?: number;
  /** Max retries on transient failure (default 2). */
  retries?: number;
  /** Retry on non-2xx HTTP responses too (default false). */
  retryOnHttpError?: boolean;
  /** Short label for diagnostics. */
  label?: string;
}

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Sleep that resolves early if `signal` aborts, so a backoff never outlives the deadline. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Node's global `fetch` wraps transient failures as `TypeError: 'fetch failed'`
 * with the real code one level deep at `err.cause.code`. Walk the cause chain so
 * code-based classification actually fires instead of relying on message text.
 */
function collectErrorCodes(err: unknown): string[] {
  const codes: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    cur = (cur as { cause?: unknown }).cause;
  }
  return codes;
}

/** Network-level errors worth retrying (DNS/reset/timeout), not logic errors. */
export function isRetryableNetworkError(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  if (e?.name === "AbortError") return false;
  if (collectErrorCodes(err).some((c) => RETRYABLE_CODES.has(c))) return true;
  return /fetch failed|network|socket|ECONNRESET|ETIMEDOUT/i.test(e?.message || "");
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    method = "GET",
    headers,
    body,
    signal,
    timeoutMs = 30_000,
    retries = 2,
    retryOnHttpError = false,
    label = "http",
  } = options;

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Per-attempt timeout, linked to the optional external signal so either can abort.
    // `timedOut` distinguishes our own deadline (retryable) from the external
    // long-poll abort (final), since both surface as AbortError on the fetch.
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      if (!res.ok && retryOnHttpError && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        log(`WECHAT_HTTP`, `${label} HTTP ${res.status}, retry ${attempt + 1}/${retries}`);
        await sleep(backoffMs(attempt), signal);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      // External long-poll abort: surface immediately, never retry.
      if (signal?.aborted) throw err;
      // A per-attempt timeout is a transient stall — retry within budget.
      const retryable = timedOut || isRetryableNetworkError(err);
      if (attempt >= retries || !retryable) throw err;
      log(`WECHAT_HTTP`, `${label} ${timedOut ? "timeout" : (err as Error).message}, retry ${attempt + 1}/${retries}`);
      await sleep(backoffMs(attempt), signal);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onExternalAbort);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}
