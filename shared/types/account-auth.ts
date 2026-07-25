/**
 * Renderer-safe DPCC desktop authorization contract.
 *
 * Long-lived credentials, PKCE material, authorization codes, request tokens,
 * and installation identifiers must never be added to these types.
 */

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
  | "token_rejected"
  | "revoke_failed"
  | "secure_storage_unavailable"
  | "secure_storage_insecure_backend"
  | "secure_storage_encrypt_failed"
  | "secure_storage_decrypt_failed"
  | "secure_storage_write_failed"
  | "unknown";

export interface DesktopAccountSummary {
  displayName: string;
  maskedEmail?: string;
  quota?: number;
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
