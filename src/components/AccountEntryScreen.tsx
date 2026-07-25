import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ExternalLink,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  X,
} from "lucide-react";
import { PccAgentLogo } from "@/components/PccAgentLogo";
import { Button } from "@/components/ui/button";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import type {
  AccountAuthErrorCode,
  AccountAuthStatus,
} from "@shared/types/account-auth";

interface AccountEntryScreenProps {
  variant: "welcome" | "settings" | "compact";
  onConnected?: () => void;
  onContinueAsGuest?: () => void;
  onOpenSettings?: () => void;
}

const CONNECTED_STATUSES = new Set<AccountAuthStatus>(["connected", "expiring"]);

function errorTranslationKey(errorCode: AccountAuthErrorCode): string {
  return `accountAuth.errors.${errorCode}`;
}

export const AccountEntryScreen = memo(function AccountEntryScreen({
  variant,
  onConnected,
  onContinueAsGuest,
  onOpenSettings,
}: AccountEntryScreenProps) {
  const { t } = useTranslation("common");
  const { t: tWelcome } = useTranslation("welcome");
  const auth = useAccountAuth();
  const [showLocalClear, setShowLocalClear] = useState(false);
  const snapshot = auth.snapshot;
  const status = snapshot?.status ?? "signed_out";
  const connected = CONNECTED_STATUSES.has(status);
  const authorizing = status === "authorizing";
  const compact = variant === "compact";
  const settingsHeaderSignIn =
    variant === "settings" &&
    !connected &&
    !authorizing &&
    status !== "storage_error";

  const startAuthorization = useCallback(() => {
    setShowLocalClear(false);
    void auth.beginAuthorization();
  }, [auth]);

  const chooseGuest = useCallback(async () => {
    const result = await auth.continueAsGuest();
    if (result.ok) onContinueAsGuest?.();
  }, [auth, onContinueAsGuest]);

  const logout = useCallback(async () => {
    const result = await auth.logoutAndRevoke();
    setShowLocalClear(!result.ok && result.canClearLocally === true);
  }, [auth]);

  const clearLocal = useCallback(async () => {
    const result = await auth.clearLocalAuthorization();
    if (result.ok) setShowLocalClear(false);
  }, [auth]);

  const expiresLabel = snapshot?.expiresAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(snapshot.expiresAt)
    : null;

  const errorMessage = snapshot?.errorCode
    ? t(errorTranslationKey(snapshot.errorCode), {
        defaultValue: t("accountAuth.errors.unknown"),
      })
    : null;

  if (variant === "welcome") {
    return (
      <div className="flex w-full flex-col items-center">
        <div className="relative">
          <PccAgentLogo className="h-16 w-16 rounded-2xl shadow-sm" />
          {authorizing ? (
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-foreground text-background">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            </span>
          ) : null}
        </div>

        <h2
          className="mt-5 text-5xl italic text-primary"
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
          }}
        >
          {tWelcome("accountStep.title")}
        </h2>
        <p className="mt-3 max-w-sm text-center text-base text-muted-foreground">
          {connected
            ? t("accountAuth.status.connected")
            : authorizing
              ? t("accountAuth.status.authorizing")
              : tWelcome("accountStep.subtitle")}
        </p>

        {connected ? (
          <div className="mt-6 w-full max-w-sm space-y-2 border-y border-foreground/10 py-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">{t("accountAuth.account")}</span>
              <span className="truncate text-sm font-medium">
                {snapshot?.account?.displayName ?? t("accountAuth.connectedAccount")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">{t("accountAuth.device")}</span>
              <span className="truncate text-sm">{snapshot?.deviceName}</span>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-5 flex max-w-sm items-start gap-2 text-center text-xs leading-relaxed text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {authorizing ? (
          <Button
            variant="outline"
            className="mt-7 rounded-full px-8"
            onClick={() => void auth.cancelAuthorization()}
          >
            <X className="h-4 w-4" />
            {t("accountAuth.cancel")}
          </Button>
        ) : connected ? (
          <Button
            className="mt-7 h-auto rounded-full px-8 py-3 text-base font-semibold"
            onClick={onConnected}
          >
            {t("accountAuth.continue")}
          </Button>
        ) : status === "storage_error" ? (
          <Button
            variant="outline"
            className="mt-7 rounded-full px-8"
            onClick={() => void auth.refresh()}
          >
            <RefreshCw className="h-4 w-4" />
            {t("action.retry")}
          </Button>
        ) : (
          <Button
            className="mt-7 h-auto rounded-full px-8 py-3 text-base font-semibold"
            onClick={startAuthorization}
            disabled={auth.actionPending}
          >
            <LogIn className="h-4 w-4" />
            {t("accountAuth.authorizeSignIn")}
          </Button>
        )}

        {!authorizing ? (
          <button
            className="mt-4 text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            onClick={chooseGuest}
          >
            {t("accountAuth.continueAsGuest")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-3 p-4" : "w-full space-y-3"}>
      <div className="flex items-center gap-3">
        <div className="relative">
          <PccAgentLogo className="h-10 w-10 rounded-lg shadow-sm" />
          {authorizing ? (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-background bg-foreground text-background">
              <LoaderCircle className="h-2.5 w-2.5 animate-spin" />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {snapshot?.account?.displayName ?? t("accountAuth.connectedAccount")}
          </h2>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected
                  ? "bg-emerald-500"
                  : authorizing
                    ? "bg-amber-500"
                    : "bg-muted-foreground/40"
              }`}
            />
            <span className="truncate">{t(`accountAuth.status.${status}`)}</span>
          </div>
        </div>
        {settingsHeaderSignIn ? (
          <Button
            size="sm"
            className="shrink-0"
            onClick={startAuthorization}
            disabled={auth.actionPending}
          >
            <LogIn className="h-4 w-4" />
            {t("accountAuth.signIn")}
          </Button>
        ) : null}
        {variant === "settings" && connected ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void auth.reauthorize()}
              disabled={auth.actionPending}
            >
              <RefreshCw className="h-4 w-4" />
              {t("accountAuth.reauthorize")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={logout}
              disabled={auth.actionPending}
            >
              <LogOut className="h-4 w-4" />
              {t("accountAuth.logout")}
            </Button>
          </>
        ) : null}
        {!compact ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground/70"
            title={t("action.refresh")}
            onClick={() => void auth.refresh()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${auth.loading ? "animate-spin" : ""}`} />
          </Button>
        ) : null}
      </div>

      {connected ? (
        <div className="space-y-2 border-t border-foreground/[0.08] pt-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">{t("accountAuth.account")}</span>
            <span className="truncate text-sm font-medium">
              {snapshot?.account?.displayName ?? t("accountAuth.connectedAccount")}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">{t("accountAuth.device")}</span>
            <span className="truncate text-sm">{snapshot?.deviceName}</span>
          </div>
          {expiresLabel ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">{t("accountAuth.expires")}</span>
              <span className="text-sm">{expiresLabel}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {snapshot?.legacyManual ? (
        <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
          {t("accountAuth.legacyManual")}
        </p>
      ) : null}

      {errorMessage ? (
        <div className="flex items-start gap-2 border-l-2 border-destructive/60 pl-3 text-xs leading-relaxed text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {!settingsHeaderSignIn && !(variant === "settings" && connected) ? (
        <div className={compact ? "space-y-2" : "flex flex-wrap items-center gap-2"}>
          {authorizing ? (
            <Button
              variant="outline"
              size={compact ? "sm" : "default"}
              onClick={() => void auth.cancelAuthorization()}
            >
              <X className="h-4 w-4" />
              {t("accountAuth.cancel")}
            </Button>
          ) : connected ? (
            <>
              <Button
                variant="outline"
                size={compact ? "sm" : "default"}
                onClick={() => void auth.reauthorize()}
                disabled={auth.actionPending}
              >
                <RefreshCw className="h-4 w-4" />
                {t("accountAuth.reauthorize")}
              </Button>
              {variant === "settings" ? (
                <Button
                  variant="outline"
                  onClick={logout}
                  disabled={auth.actionPending}
                >
                  <LogOut className="h-4 w-4" />
                  {t("accountAuth.logout")}
                </Button>
              ) : null}
            </>
          ) : status === "storage_error" ? (
            <Button variant="outline" onClick={() => void auth.refresh()}>
              <RefreshCw className="h-4 w-4" />
              {t("action.retry")}
            </Button>
          ) : (
            <Button
              className={compact ? "w-full" : undefined}
              size={compact ? "sm" : "default"}
              onClick={startAuthorization}
              disabled={auth.actionPending}
            >
              <LogIn className="h-4 w-4" />
              {t("accountAuth.signIn")}
            </Button>
          )}

          {variant === "compact" && onOpenSettings ? (
            <Button variant="ghost" size="sm" className="w-full" onClick={onOpenSettings}>
              <ExternalLink className="h-4 w-4" />
              {t("accountAuth.accountSettings")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showLocalClear ? (
        <div className="space-y-2 border-t border-foreground/[0.08] pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("accountAuth.revokeFailed")}
          </p>
          <Button variant="destructive" size="sm" onClick={clearLocal}>
            {t("accountAuth.clearLocal")}
          </Button>
        </div>
      ) : null}

    </div>
  );
});
