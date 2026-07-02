import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CircleUser, RefreshCw, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { UsageStatsCard } from "@/components/settings/UsageStatsCard";
import { useAccount } from "@/hooks/useAccount";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";
import type { AppSettings } from "@/types";

interface AccountSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const INPUT_CLASS =
  "h-8 w-full rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20";

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function normalizeHost(raw: string): string {
  const n = raw.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return n || DEFAULT_NEWAPI_BASE_URL;
}

/** Small on/off credential pill. */
const Chip = memo(function Chip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        on
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-foreground/[0.05] text-muted-foreground"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
      {label}
    </span>
  );
});

/** Default-model picker: native select from fetched models, or a text input when none. */
const ModelField = memo(function ModelField({
  value,
  models,
  autoLabel,
  placeholder,
  onChange,
}: {
  value: string;
  models: string[];
  autoLabel: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  if (models.length === 0) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT_CLASS}
        spellCheck={false}
        autoComplete="off"
      />
    );
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS}>
      <option value="">{autoLabel}</option>
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
});

/** Stacked label + control for the edit form. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-foreground/70">{label}</span>
      {children}
    </div>
  );
}

export const AccountSettings = memo(function AccountSettings({
  appSettings,
  onUpdateAppSettings,
}: AccountSettingsProps) {
  const { t } = useTranslation("settings");
  const account = useAccount(true);
  const { config, status, balance, claudeModels, codexModels } = account;

  const [host, setHost] = useState("");
  const [claudeToken, setClaudeToken] = useState("");
  const [codexToken, setCodexToken] = useState("");
  const [claudeModel, setClaudeModel] = useState("");
  const [codexModel, setCodexModel] = useState("");
  const [userId, setUserId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!appSettings) return;
    // The DPCC account lives in dpccUpstream now (the "default" upstream tier),
    // separate from the custom third-party gateway in Settings → Engines.
    const d = appSettings.dpccUpstream;
    setHost(normalizeHost(d?.baseUrl || ""));
    setClaudeToken(d?.claudeToken || "");
    setCodexToken(d?.codexToken || "");
    setClaudeModel(d?.claudeModel || "");
    setCodexModel(d?.codexModel || "");
    setUserId(appSettings.accountUserId || "");
    setAccessToken(appSettings.accountAccessToken || "");
  }, [appSettings]);

  const handleSave = useCallback(async () => {
    if (!appSettings) return;
    setSaving(true);
    try {
      const h = normalizeHost(host);
      await onUpdateAppSettings({
        dpccUpstream: {
          ...appSettings.dpccUpstream,
          baseUrl: h,
          claudeToken: claudeToken.trim(),
          codexToken: codexToken.trim(),
          claudeModel: claudeModel.trim(),
          codexModel: codexModel.trim(),
        },
        accountAccessToken: accessToken.trim(),
        accountUserId: userId.trim(),
      });
      await account.refresh();
    } finally {
      setSaving(false);
    }
  }, [appSettings, host, claudeToken, codexToken, claudeModel, codexModel, accessToken, userId, onUpdateAppSettings, account]);

  const connected = !!(config && config.hasToken && config.source !== "none");
  const sourceLabel = config
    ? config.source === "dpcc"
      ? t("account.source.dpcc")
      : t("account.source.none")
    : "—";
  const statusLabel = !config
    ? "—"
    : connected
      ? t("account.status.connected")
      : t("account.status.notConnected");

  const usedPct =
    balance && !balance.unlimited && balance.totalUsd > 0
      ? Math.min(100, (balance.usedUsd / balance.totalUsd) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-6 py-5">
          {/* ── Account status ── */}
          <div className="border-b border-foreground/[0.06] pb-4">
            {/* Identity row */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary">
                {status?.logoUrl ? (
                  <img src={status.logoUrl} className="h-10 w-10 object-cover" alt="" />
                ) : (
                  <CircleUser className="h-6 w-6" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {status?.name || (config ? hostOf(config.baseUrl) : "—")}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  {statusLabel}
                  <span className="text-muted-foreground/40">·</span>
                  {sourceLabel}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground/70"
                onClick={() => void account.refresh()}
                title={t("account.refresh")}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${account.loading ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {/* Balance */}
            <div className="mt-4 border-t border-foreground/[0.06] pt-4">
              {balance ? (
                balance.unlimited ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums text-foreground">
                      ${balance.usedUsd.toFixed(2)}
                    </span>
                    <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t("account.unlimited")}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground">{t("account.balanceLabel")}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        ${balance.usedUsd.toFixed(2)} / ${balance.totalUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-2xl font-semibold tabular-nums text-foreground">
                      ${balance.remainingUsd.toFixed(2)}
                    </div>
                    <div className="mt-3 h-1.5 w-full overflow-hidden bg-foreground/10">
                      <div className="h-full bg-primary" style={{ width: `${usedPct}%` }} />
                    </div>
                  </>
                )
              ) : (
                <div className="text-xs text-muted-foreground">
                  {account.error ? t("account.balanceError") : t("account.balanceUnavailable")}
                </div>
              )}
            </div>

            {/* Credential chips + model counts */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-foreground/[0.06] pt-4">
              <Chip label={`${t("account.claudeKey")}${claudeModels.length ? ` · ${claudeModels.length}` : ""}`} on={!!config?.hasClaudeToken} />
              <Chip label={`${t("account.codexKey")}${codexModels.length ? ` · ${codexModels.length}` : ""}`} on={!!config?.hasCodexToken} />
              <Chip label={t("account.accessToken")} on={!!config?.hasAccessToken} />
            </div>
          </div>

          {/* ── Token activity ── */}
          <UsageStatsCard />

          {/* ── Edit form (collapsible, inline — no nested card) ── */}
          <Collapsible open={editOpen} onOpenChange={setEditOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-1 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
              <ChevronRight className={`h-4 w-4 transition-transform ${editOpen ? "rotate-90" : ""}`} />
              {t("account.editCredentials")}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-3 px-1 pt-3">
                <Field label={t("account.field.baseUrl")}>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder={DEFAULT_NEWAPI_BASE_URL}
                    className={INPUT_CLASS}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("account.field.claudeToken")}>
                    <input
                      value={claudeToken}
                      onChange={(e) => setClaudeToken(e.target.value)}
                      type="password"
                      placeholder="sk-…"
                      className={INPUT_CLASS}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label={t("account.field.claudeModel")}>
                    <ModelField
                      value={claudeModel}
                      models={claudeModels}
                      autoLabel={t("account.field.modelAuto")}
                      placeholder={t("account.field.modelPlaceholder")}
                      onChange={setClaudeModel}
                    />
                  </Field>
                  <Field label={t("account.field.codexToken")}>
                    <input
                      value={codexToken}
                      onChange={(e) => setCodexToken(e.target.value)}
                      type="password"
                      placeholder="sk-…"
                      className={INPUT_CLASS}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label={t("account.field.codexModel")}>
                    <ModelField
                      value={codexModel}
                      models={codexModels}
                      autoLabel={t("account.field.modelAuto")}
                      placeholder={t("account.field.modelPlaceholder")}
                      onChange={setCodexModel}
                    />
                  </Field>
                </div>

                <div className="border-t border-foreground/[0.06] pt-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("account.balanceCredsLabel")}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("account.field.userId")}>
                      <input
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                        inputMode="numeric"
                        placeholder="1"
                        className={INPUT_CLASS}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </Field>
                    <Field label={t("account.field.accessToken")}>
                      <input
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                        type="password"
                        placeholder={t("account.field.accessTokenPlaceholder")}
                        className={INPUT_CLASS}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </Field>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    disabled={saving || !appSettings}
                    onClick={() => {
                      void handleSave().catch(() => {});
                    }}
                  >
                    {t("account.save")}
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  );
});
