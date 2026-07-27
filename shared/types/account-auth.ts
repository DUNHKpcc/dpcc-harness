/**
 * Renderer-safe DPCC desktop authorization contract.
 *
 * Long-lived credentials, PKCE material, authorization codes, request tokens,
 * and installation identifiers must never be added to these types.
 */

import type { AccountSubscription } from "./account";

export type AccountAuthStatus =
  | "signed_out"
  | "authorizing"
  | "connected"
  | "expiring"
  | "expired"
  | "revoked"
  | "guest"
  | "storage_error";

export type AccountAuthErrorCode =
  | "authorization_cancelled"
  | "authorization_in_progress"
  | "authorization_request_failed"
  | "authorization_url_invalid"
  | "browser_open_failed"
  | "callback_invalid"
  | "callback_state_mismatch"
  | "callback_timeout"
  | "access_denied"
  | "request_expired"
  | "token_exchange_failed"
  | "token_confirmation_failed"
  | "token_confirmation_expired"
  | "device_limit_reached"
  | "token_rejected"
  | "revoke_failed"
  | "secure_storage_unavailable"
  | "secure_storage_insecure_backend"
  | "secure_storage_encrypt_failed"
  | "secure_storage_decrypt_failed"
  | "secure_storage_write_failed"
  | "unknown";

export const DESKTOP_CONTRACT_VERSION = 2;

export const DESKTOP_CONTRACT_ERROR_CODES = [
  "DESKTOP_INTERNAL_ERROR",
  "DESKTOP_UNSUPPORTED_CLIENT",
  "DESKTOP_INVALID_REDIRECT_URI",
  "DESKTOP_INVALID_PKCE",
  "DESKTOP_INVALID_REQUEST",
  "DESKTOP_BROWSER_SESSION_REQUIRED",
  "DESKTOP_REQUEST_EXPIRED",
  "DESKTOP_REQUEST_CONSUMED",
  "DESKTOP_DEVICE_LIMIT",
  "DESKTOP_TOKEN_GROUP_UNAVAILABLE",
  "DESKTOP_TOKEN_INVALID",
  "DESKTOP_SCOPE_DENIED",
  "DESKTOP_CONFIRMATION_INVALID",
  "DESKTOP_CONFIRMATION_EXPIRED",
  "DESKTOP_NOT_FOUND",
  "DESKTOP_GRANT_NOT_FOUND",
] as const;

export type DesktopContractErrorCode = typeof DESKTOP_CONTRACT_ERROR_CODES[number];

export interface DesktopAccountSummary {
  displayName: string;
  maskedEmail?: string;
  quota?: number;
  subscription?: AccountSubscription;
  subscriptionState?: string;
  allowedModels?: string[];
}

export interface AccountAuthSnapshot {
  status: AccountAuthStatus;
  issuer: string;
  clientId: string;
  deviceName: string;
  account: DesktopAccountSummary | null;
  expiresAt: number | null;
  scopes: string[];
  legacyManual: boolean;
  errorCode?: AccountAuthErrorCode;
}

export interface AccountAuthActionResult {
  ok: boolean;
  errorCode?: AccountAuthErrorCode;
  canClearLocally?: boolean;
}
