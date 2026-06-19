import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Wallet } from "lucide-react";
import type { WizardStepProps } from "./shared";
import { useAccount } from "@/hooks/useAccount";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";

const INPUT_CLASS =
  "w-full rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-foreground/30";

export function AccountStep({ onNext }: WizardStepProps) {
  const { t } = useTranslation("welcome");
  // active=false: we don't need balance/models here, but status (name + logo)
  // still loads on mount so we can brand the step.
  const { status, saveAccount } = useAccount(false);

  const [host, setHost] = useState(DEFAULT_NEWAPI_BASE_URL);
  const [claudeToken, setClaudeToken] = useState("");
  const [codexToken, setCodexToken] = useState("");
  const [userId, setUserId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave =
    host.trim().length > 0 &&
    (claudeToken.trim().length > 0 ||
      codexToken.trim().length > 0 ||
      (accessToken.trim().length > 0 && userId.trim().length > 0)) &&
    !saving;

  const handleConnect = useCallback(async () => {
    setSaving(true);
    try {
      const hasBalanceCreds = accessToken.trim().length > 0 && userId.trim().length > 0;
      await saveAccount({
        host,
        claudeToken,
        codexToken,
        accessToken: hasBalanceCreds ? accessToken : undefined,
        userId: hasBalanceCreds ? userId : undefined,
      });
      onNext();
    } finally {
      setSaving(false);
    }
  }, [host, claudeToken, codexToken, userId, accessToken, saveAccount, onNext]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-6">
      <motion.div
        className="mb-5 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-foreground/[0.06]"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        {status?.logoUrl ? (
          <img src={status.logoUrl} className="h-16 w-16 object-cover" alt="" />
        ) : (
          <Wallet className="h-8 w-8 text-foreground/60" />
        )}
      </motion.div>

      <motion.h2
        className="text-5xl italic"
        style={{ fontFamily: "'Instrument Serif', Georgia, serif", color: "oklch(0.68 0.18 145)" }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {status?.name || t("accountStep.title")}
      </motion.h2>

      <motion.p
        className="mt-3 max-w-sm text-center text-base text-muted-foreground"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.18 }}
      >
        {t("accountStep.subtitle")}
      </motion.p>

      <motion.div
        className="mt-7 w-full max-w-sm space-y-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.26 }}
      >
        {/* Gateway keys (Claude required-ish, Codex optional) */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground/70">{t("accountStep.gatewayLabel")}</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">{t("accountStep.gatewayHint")}</p>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={t("accountStep.gatewayUrlPlaceholder")}
            className={INPUT_CLASS}
            autoComplete="off"
            spellCheck={false}
          />
          <label className="block text-[11px] font-medium text-muted-foreground/80">
            {t("accountStep.claudeKeyLabel")}
          </label>
          <input
            value={claudeToken}
            onChange={(e) => setClaudeToken(e.target.value)}
            placeholder={t("accountStep.tokenPlaceholder")}
            type="password"
            className={INPUT_CLASS}
            autoComplete="off"
            spellCheck={false}
          />
          <label className="block text-[11px] font-medium text-muted-foreground/80">
            {t("accountStep.codexKeyLabel")}
          </label>
          <input
            value={codexToken}
            onChange={(e) => setCodexToken(e.target.value)}
            placeholder={t("accountStep.tokenPlaceholder")}
            type="password"
            className={INPUT_CLASS}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Balance display (optional) */}
        <div className="space-y-2 border-t border-foreground/10 pt-4">
          <p className="text-xs font-medium text-foreground/70">{t("accountStep.balanceLabel")}</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">{t("accountStep.balanceHint")}</p>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={t("accountStep.userIdPlaceholder")}
            inputMode="numeric"
            className={INPUT_CLASS}
            autoComplete="off"
            spellCheck={false}
          />
          <input
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={t("accountStep.accessTokenPlaceholder")}
            type="password"
            className={INPUT_CLASS}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </motion.div>

      <motion.button
        onClick={handleConnect}
        disabled={!canSave}
        className="mt-7 rounded-full bg-foreground px-8 py-3.5 text-base font-semibold text-background transition-opacity hover:opacity-85 disabled:pointer-events-none disabled:opacity-40"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.34 }}
      >
        {t("accountStep.connect")}
      </motion.button>

      <motion.button
        onClick={onNext}
        className="mt-4 text-sm text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.42 }}
      >
        {t("accountStep.skipForNow")}
      </motion.button>
    </div>
  );
}
