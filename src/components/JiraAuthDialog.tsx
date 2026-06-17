/**
 * Dialog for authenticating with Jira
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface JiraAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceUrl: string;
  onSuccess: () => void;
}

export function JiraAuthDialog({
  open,
  onOpenChange,
  instanceUrl,
  onSuccess,
}: JiraAuthDialogProps) {
  const { t } = useTranslation("dialogs");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError(t("jiraAuth.emailRequired"));
      return;
    }

    if (!apiToken.trim()) {
      setError(t("jiraAuth.apiTokenRequired"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.claude.jira.authenticate(
        instanceUrl,
        "apitoken",
        apiToken,
        email.trim()
      );

      if (result.error) {
        setError(result.error);
        setLoading(false);
      } else {
        setLoading(false);
        setEmail("");
        setApiToken("");
        onSuccess();
        onOpenChange(false);
      }
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setEmail("");
      setApiToken("");
      setError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("jiraAuth.title")}</DialogTitle>
          <DialogDescription>
            {t("jiraAuth.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="instanceUrl" className="text-sm font-medium">
                {t("jiraAuth.instanceUrl")}
              </label>
              <Input
                id="instanceUrl"
                value={instanceUrl}
                disabled
                className="opacity-60"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                {t("jiraAuth.email")}
              </label>
              <Input
                id="email"
                type="email"
                placeholder={t("jiraAuth.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoFocus
              />
              <p className="text-sm text-muted-foreground">
                {t("jiraAuth.emailHelp")}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="apiToken" className="text-sm font-medium">
                {t("jiraAuth.apiToken")}
              </label>
              <Input
                id="apiToken"
                type="password"
                placeholder={t("jiraAuth.apiTokenPlaceholder")}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                disabled={loading}
              />
              <p className="text-sm text-muted-foreground">
                {t("jiraAuth.createTokenAt")}
                <a
                  href="https://id.atlassian.com/manage-profile/security/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  id.atlassian.com
                </a>
              </p>
            </div>

            {error && (
              <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-md p-3">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              {t("action.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t("jiraAuth.authenticating") : t("jiraAuth.connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
