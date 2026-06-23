import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CircleUser, RefreshCw, Settings, ChevronDown, CreditCard, Globe, ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  shouldLoadAccountDetails,
  useAccount,
  type UseAccountResult,
  type SaveAccountInput,
} from "@/hooks/useAccount";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";

/** External quick links surfaced in the account panel footer. */
const ACCOUNT_LINKS = {
  recharge: "https://dpccgaming.xyz/payment",
  website: "https://api.dpccgaming.xyz",
} as const;

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60";

/** Extract the host portion of a URL for compact display. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Renders the new-api site logo when available, falling back to a generic icon. */
const AccountAvatar = memo(function AccountAvatar({
  logoUrl,
  imgClassName,
  iconClassName,
}: {
  logoUrl: string | undefined;
  imgClassName: string;
  iconClassName: string;
}) {
  const [err, setErr] = useState(false);
  if (logoUrl && !err) {
    return <img src={logoUrl} onError={() => setErr(true)} className={imgClassName} alt="" />;
  }
  return <CircleUser className={iconClassName} />;
});

// ── Guided setup card (shown when no upstream is configured) ──

const SetupCard = memo(function SetupCard({
  t,
  onSave,
}: {
  t: TFunction<"workspace">;
  onSave: (input: SaveAccountInput) => Promise<void>;
}) {
  const [host, setHost] = useState(DEFAULT_NEWAPI_BASE_URL);
  const [claudeToken, setClaudeToken] = useState("");
  const [codexToken, setCodexToken] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const canSave =
    host.trim().length > 0 &&
    (claudeToken.trim().length > 0 ||
      codexToken.trim().length > 0 ||
      (accessToken.trim().length > 0 && userId.trim().length > 0)) &&
    !saving;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const hasBalanceCreds = accessToken.trim().length > 0 && userId.trim().length > 0;
      await onSave({
        host,
        claudeToken,
        codexToken,
        accessToken: hasBalanceCreds ? accessToken : undefined,
        userId: hasBalanceCreds ? userId : undefined,
      });
    } finally {
      setSaving(false);
    }
  }, [host, claudeToken, codexToken, accessToken, userId, onSave]);

  return (
    <div className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("account.setup.title")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("account.setup.intro")}</p>
      </div>
      <div className="space-y-2">
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder={t("account.setup.baseUrlPlaceholder")}
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
        <label className="block text-[11px] font-medium text-muted-foreground">
          {t("account.setup.claudeKeyLabel")}
        </label>
        <input
          value={claudeToken}
          onChange={(e) => setClaudeToken(e.target.value)}
          placeholder={t("account.setup.tokenPlaceholder")}
          type="password"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
        <label className="block text-[11px] font-medium text-muted-foreground">
          {t("account.setup.codexKeyLabel")}
        </label>
        <input
          value={codexToken}
          onChange={(e) => setCodexToken(e.target.value)}
          placeholder={t("account.setup.tokenPlaceholder")}
          type="password"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Optional balance lookup creds */}
      <div className="space-y-2 border-t border-border/60 pt-3">
        <p className="text-[11px] font-medium text-muted-foreground">{t("account.setup.balanceSection")}</p>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={t("account.userIdPlaceholder")}
          inputMode="numeric"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
        <input
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder={t("account.setup.accessTokenPlaceholder")}
          type="password"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <Button size="sm" className="w-full" disabled={!canSave} onClick={handleSave}>
        {t("account.setup.save")}
      </Button>
    </div>
  );
});

// ── Available models list (collapsible, one per engine) ──

const ModelsSection = memo(function ModelsSection({
  t,
  label,
  models,
}: {
  t: TFunction<"workspace">;
  label: string;
  models: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-border/60 px-4 py-3">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between text-xs"
        disabled={models.length === 0}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {models.length === 0 ? t("account.noModels") : models.length}
          {models.length > 0 && (
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          )}
        </span>
      </button>
      {expanded && models.length > 0 && (
        <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
          {models.map((m) => (
            <div
              key={m}
              className="truncate rounded bg-foreground/[0.03] px-2 py-1 font-mono text-[11px] text-foreground/80"
            >
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ── Inline access-token adder (real account balance via /api/user/self) ──

const AccessTokenAdder = memo(function AccessTokenAdder({
  t,
  onSave,
}: {
  t: TFunction<"workspace">;
  onSave: (accessToken: string, userId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const canSave = token.trim().length > 0 && userId.trim().length > 0 && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(token, userId);
      setOpen(false);
      setToken("");
      setUserId("");
    } finally {
      setSaving(false);
    }
  }, [canSave, token, userId, onSave]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-[11px] text-primary/80 underline-offset-2 hover:underline"
      >
        {t("account.addAccessToken")}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("account.accessTokenHint")}</p>
      <input
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder={t("account.userIdPlaceholder")}
        inputMode="numeric"
        className={INPUT_CLASS}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="flex items-center gap-1.5">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("account.setup.accessTokenPlaceholder")}
          type="password"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
        <Button size="sm" disabled={!canSave} onClick={handleSave}>
          {t("account.setup.save")}
        </Button>
      </div>
    </div>
  );
});

// ── Connected account view ──

const AccountView = memo(function AccountView({
  t,
  account,
  onSettings,
}: {
  t: TFunction<"workspace">;
  account: UseAccountResult;
  onSettings: () => void;
}) {
  const cfg = account.config;
  const balance = account.balance;
  const usedPct =
    balance && !balance.unlimited && balance.totalUsd > 0
      ? Math.min(100, (balance.usedUsd / balance.totalUsd) * 100)
      : 0;
  // Offer the access-token shortcut when we can't show a real remaining balance.
  const showAdder =
    cfg != null && !cfg.hasAccessToken && (balance == null || balance.unlimited);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 pb-3 pt-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary">
          <AccountAvatar
            logoUrl={account.status?.logoUrl}
            imgClassName="h-8 w-8 object-cover"
            iconClassName="h-5 w-5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {account.status?.name || (cfg ? hostOf(cfg.baseUrl) : "")}
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

      {/* Balance */}
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
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                <div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
              </div>
            </>
          )
        ) : (
          <div className="text-xs text-muted-foreground">
            {account.error ? t("account.balanceError") : t("account.balanceUnavailable")}
          </div>
        )}
        {showAdder && <AccessTokenAdder t={t} onSave={account.saveAccessToken} />}
      </div>

      {/* Available models — one section per engine */}
      {cfg?.hasClaudeToken && (
        <ModelsSection t={t} label={t("account.claudeModels")} models={account.claudeModels} />
      )}
      {cfg?.hasCodexToken && (
        <ModelsSection t={t} label={t("account.codexModels")} models={account.codexModels} />
      )}

      {/* Footer — quick links + settings entry */}
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
          onClick={onSettings}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5"
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
          {t("space.settings")}
        </button>
      </div>
    </div>
  );
});

// ── Popover host ──

export const AccountPopover = memo(function AccountPopover({
  onOpenSettings,
}: {
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation("workspace");
  const [open, setOpen] = useState(false);
  const account = useAccount(open);

  // The account button is an optional login entry point — it never force-opens.
  // (Auto-opening the setup card on first launch was removed: the product does
  // not require connecting a DPCC API account, and the popup felt coercive.)

  const handleSettings = useCallback(() => {
    setOpen(false);
    onOpenSettings?.();
  }, [onOpenSettings]);

  const cfg = account.config;
  const needsSetup = !cfg || !shouldLoadAccountDetails(cfg);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className="mb-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sidebar-foreground/40 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
            >
              <AccountAvatar
                logoUrl={account.status?.logoUrl}
                imgClassName="h-5 w-5 rounded object-contain"
                iconClassName="h-4.5 w-4.5"
              />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t("space.account")}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="start" sideOffset={12} className="w-80 p-0">
        {account.loading && !cfg ? (
          <div className="p-4 text-xs text-muted-foreground">{t("account.loading")}</div>
        ) : needsSetup ? (
          <SetupCard t={t} onSave={account.saveAccount} />
        ) : (
          <AccountView t={t} account={account} onSettings={handleSettings} />
        )}
      </PopoverContent>
    </Popover>
  );
});
