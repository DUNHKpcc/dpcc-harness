import { log } from "../logger";
import { fetchWithRetry } from "./http";
import type { Credentials, QRCodeResponse, QRCodeStatusResponse } from "./types";
import type { WeChatLoginStatus } from "@shared/types/wechat";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

export interface LoginCallbacks {
  /** Emits the QR string to encode + display for scanning. */
  onQRCode: (content: string) => void;
  /** Emits scan lifecycle updates (wait/scaned/confirmed/expired). */
  onStatus: (status: WeChatLoginStatus) => void;
}

class LoginCancelledError extends Error {
  constructor() {
    super("登录已取消");
    this.name = "LoginCancelledError";
  }
}

export function isLoginCancelled(err: unknown): boolean {
  return err instanceof LoginCancelledError;
}

async function getQRCode(signal: AbortSignal): Promise<QRCodeResponse> {
  const res = await fetchWithRetry(
    `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
    { label: "QR", retries: 4, retryOnHttpError: true, timeoutMs: 20_000, signal },
  );
  if (!res.ok) throw new Error(`获取二维码失败: HTTP ${res.status}`);
  return (await res.json()) as QRCodeResponse;
}

async function pollQRCodeStatus(qrcode: string, signal: AbortSignal): Promise<QRCodeStatusResponse> {
  const res = await fetchWithRetry(
    `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    { headers: { "iLink-App-ClientVersion": "1" }, label: "QR-status", retries: 1, timeoutMs: 15_000, signal },
  );
  if (!res.ok) throw new Error(`轮询二维码状态失败: HTTP ${res.status}`);
  return (await res.json()) as QRCodeStatusResponse;
}

/**
 * Full QR login flow. Refreshes the QR up to a few times, polling scan status
 * every 2s until the user confirms on their phone. Honors `signal` so the UI
 * can cancel an in-progress login.
 */
export async function login(callbacks: LoginCallbacks, signal: AbortSignal): Promise<Credentials> {
  const maxRefreshes = 3;

  for (let attempt = 0; attempt < maxRefreshes; attempt++) {
    throwIfAborted(signal);
    const qr = await getQRCode(signal);

    // qrcode_img_content is the string to encode as a QR for scanning.
    callbacks.onQRCode(qr.qrcode_img_content || qr.qrcode);
    callbacks.onStatus("wait");
    log("WECHAT_AUTH", "等待微信扫码登录…");

    const deadline = Date.now() + 5 * 60 * 1000; // 5 min per QR

    while (Date.now() < deadline) {
      await sleep(2000, signal);
      throwIfAborted(signal);
      try {
        const status = await pollQRCodeStatus(qr.qrcode, signal);

        if (status.status === "scaned") {
          callbacks.onStatus("scaned");
          log("WECHAT_AUTH", "已扫码，请在手机上确认…");
        } else if (status.status === "confirmed") {
          if (!status.bot_token || !status.ilink_bot_id || !status.ilink_user_id) {
            throw new Error("登录响应缺少凭据字段");
          }
          callbacks.onStatus("confirmed");
          log("WECHAT_AUTH", "登录成功");
          return {
            botToken: status.bot_token,
            baseUrl: status.baseurl || DEFAULT_BASE_URL,
            ilinkBotId: status.ilink_bot_id,
            ilinkUserId: status.ilink_user_id,
          };
        } else if (status.status === "expired") {
          callbacks.onStatus("expired");
          log("WECHAT_AUTH", "二维码已过期");
          break;
        }
      } catch (err) {
        if (signal.aborted) throw new LoginCancelledError();
        log("WECHAT_AUTH", `轮询状态出错: ${(err as Error).message}`);
      }
    }
  }

  throw new Error("登录超时，请重试");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new LoginCancelledError();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new LoginCancelledError());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LoginCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
