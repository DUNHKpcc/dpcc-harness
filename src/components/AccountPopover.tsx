import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CreditCard,
  ExternalLink,
  Globe,
  LogIn,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import { PccAgentLogo } from "@/components/PccAgentLogo";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountSubscriptionDetails } from "@/components/AccountSubscriptionDetails";
import { resolveAccountSubscription } from "@shared/lib/account-display";
import { useAccount } from "@/hooks/useAccount";
import { useAccountAuth } from "@/hooks/useAccountAuth";

const ACCOUNT_LINKS = {
  recharge: "https://api.dpccgaming.xyz/wallet",
  website: "https://api.dpccgaming.xyz",
} as const;

export const AccountPopover = memo(function AccountPopover({
  onOpenSettings,
}: {
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation("workspace");
  const { t: tCommon } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const auth = useAccountAuth();
  const authStatus = auth.snapshot?.status ?? "signed_out";
  const authorizing = authStatus === "authorizing";
  const connected = auth.snapshot?.status === "connected" || auth.snapshot?.status === "expiring";
  const account = useAccount(open && connected, { loadModels: false });
  const balance = account.balance;
  const subscription = resolveAccountSubscription(
    account.subscription,
    auth.snapshot?.account,
  );

  const openSettings = useCallback(() => {
    setOpen(false);
    onOpenSettings?.();
  }, [onOpenSettings]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              data-package-smoke="account-menu"
              className="mb-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sidebar-foreground/40 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
            >
              <PccAgentLogo className="h-5 w-5 rounded" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t("space.account")}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="start" sideOffset={12} className="w-80 p-0">
        {connected ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-2.5 border-b border-border/60 px-4 pb-3 pt-3.5">
              <PccAgentLogo className="h-8 w-8 rounded-lg shadow-sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {auth.snapshot?.account?.displayName ?? "DPCC API"}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {t("account.connected")}
                </div>
              </div>
              <button
                onClick={() => void account.refresh()}
                title={t("account.refresh")}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${account.loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="border-b border-border/60 px-4 py-3">
              {balance ? (
                balance.unlimited ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground">{t("account.used")}</span>
                      <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("account.unlimited")}
                      </span>
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                      ${balance.usedUsd.toFixed(2)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground">{t("account.balance")}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        ${balance.usedUsd.toFixed(2)} / ${balance.totalUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                      ${balance.remainingUsd.toFixed(2)}
                    </div>
                  </>
                )
              ) : (
                <div className="text-xs text-muted-foreground">
                  {account.error
                    ? t("account.balanceError")
                    : t("account.balanceUnavailable")}
                </div>
              )}
            </div>

            <div className="border-b border-border/60 px-4 py-3">
              <AccountSubscriptionDetails
                subscription={subscription}
                variant="popover"
              />
            </div>

            <div className="p-1.5">
              <button
                onClick={() => void window.claude.openExternal(ACCOUNT_LINKS.recharge)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5"
              >
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                {t("account.recharge")}
                <ExternalLink className="ms-auto h-3.5 w-3.5 text-muted-foreground/50" />
              </button>
              <button
                onClick={() => void window.claude.openExternal(ACCOUNT_LINKS.website)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5"
              >
                <Globe className="h-4 w-4 text-muted-foreground" />
                {t("account.website")}
                <ExternalLink className="ms-auto h-3.5 w-3.5 text-muted-foreground/50" />
              </button>
              <button
                data-package-smoke="open-settings"
                onClick={openSettings}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                {t("space.settings")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-2.5 border-b border-border/60 px-4 pb-3 pt-3.5">
              <PccAgentLogo className="h-8 w-8 rounded-lg shadow-sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {tCommon("accountAuth.connectedAccount")}
                </div>
              </div>
              <button
                onClick={() => void auth.refresh()}
                title={t("account.refresh")}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${auth.loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="border-b border-border/60 px-4 py-3">
              <Button
                className="w-full"
                variant={authorizing ? "outline" : "default"}
                onClick={() =>
                  void (authorizing
                    ? auth.cancelAuthorization()
                    : auth.beginAuthorization())
                }
                disabled={auth.actionPending}
              >
                {authorizing ? (
                  <>
                    <X className="h-4 w-4" />
                    {tCommon("accountAuth.cancel")}
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    {tCommon("accountAuth.authorizeSignIn")}
                  </>
                )}
              </Button>
            </div>

            <div className="p-1.5">
              <button
                onClick={() => void window.claude.openExternal(ACCOUNT_LINKS.recharge)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5"
              >
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                {t("account.recharge")}
                <ExternalLink className="ms-auto h-3.5 w-3.5 text-muted-foreground/50" />
              </button>
              <button
                onClick={() => void window.claude.openExternal(ACCOUNT_LINKS.website)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5"
              >
                <Globe className="h-4 w-4 text-muted-foreground" />
                {t("account.website")}
                <ExternalLink className="ms-auto h-3.5 w-3.5 text-muted-foreground/50" />
              </button>
              <button
                data-package-smoke="open-settings"
                onClick={openSettings}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                {t("space.settings")}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});
