import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Info, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PiLogo } from "@/components/PiLogo";
import { PluginIcon } from "./PluginIcon";
import type {
  InstalledPiPackageRecord,
  PiPackageResourceKind,
  PiPackageStatus,
} from "@/types";

const RESOURCE_KINDS: PiPackageResourceKind[] = ["extensions", "skills", "prompts", "themes"];

function reviewUrlForSource(source: string): string | null {
  const npm = source.trim().match(/^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\S+)$/i);
  if (npm) {
    return `https://www.npmjs.com/package/${encodeURIComponent(npm[1])}/v/${encodeURIComponent(npm[2])}`;
  }
  const git = source.trim().match(/^git:(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([A-Za-z0-9._/-]+)$/);
  return git ? `https://${git[1]}/tree/${encodeURIComponent(git[2])}` : null;
}

function statusClass(status: PiPackageStatus): string {
  if (status === "ready") return "border-emerald-500/35 text-emerald-700 dark:text-emerald-300";
  if (status === "missing") return "border-amber-500/35 text-amber-800 dark:text-amber-200";
  return "text-muted-foreground";
}

function resourceCounts(record: InstalledPiPackageRecord): string[] {
  return RESOURCE_KINDS.flatMap((kind) => {
    const count = record.resources.filter((resource) => resource.kind === kind).length;
    return count > 0 ? [`${kind}:${count}`] : [];
  });
}

export function PiPackagesCatalog() {
  const { t } = useTranslation("plugins");
  const [packages, setPackages] = useState<InstalledPiPackageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [source, setSource] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<InstalledPiPackageRecord | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const response = await window.claude.plugins.piPackages.listInstalled();
    if ("error" in response) {
      setError(response.error);
    } else {
      setError(null);
      setPackages(response.items);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reviewUrl = useMemo(() => reviewUrlForSource(source), [source]);

  const closeInstall = useCallback(() => {
    setInstallOpen(false);
    setSource("");
    setReviewed(false);
  }, []);

  const install = useCallback(async () => {
    const trimmedSource = source.trim();
    if (!trimmedSource || !reviewed) return;
    setInstalling(true);
    const response = await window.claude.plugins.piPackages.install({
      source: trimmedSource,
      reviewed,
    });
    setInstalling(false);
    if ("error" in response) {
      toast.error(response.error);
      return;
    }
    toast.success(t("packages.installSuccess", { name: response.item.name }));
    closeInstall();
    await refresh();
  }, [closeInstall, refresh, reviewed, source, t]);

  const setEnabled = useCallback(async (record: InstalledPiPackageRecord, enabled: boolean) => {
    setChangingId(record.id);
    const response = await window.claude.plugins.piPackages.setEnabled(record.id, enabled);
    setChangingId(null);
    if ("error" in response) {
      toast.error(response.error);
      return;
    }
    toast.success(t(enabled ? "packages.enabled" : "packages.disabled", { name: record.name }));
    await refresh();
  }, [refresh, t]);

  const remove = useCallback(async (record: InstalledPiPackageRecord) => {
    setChangingId(record.id);
    const response = await window.claude.plugins.piPackages.remove(record.id);
    setChangingId(null);
    if (response.error) {
      toast.error(response.error);
      return;
    }
    toast.success(t("packages.removeSuccess", { name: record.name }));
    setSelected((current) => current?.id === record.id ? null : current);
    await refresh();
  }, [refresh, t]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div
          data-pi-package-catalog-layout="reference"
          className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:px-8"
        >
          <header className="flex min-w-0 flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <PiLogo className="h-6 w-6 shrink-0" />
                <h1 className="text-2xl font-semibold text-foreground">{t("tabs.packages")}</h1>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("packages.subtitle")}</p>
            </div>
            <Button type="button" size="sm" onClick={() => setInstallOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("packages.add")}
            </Button>
          </header>

          <section className="mt-9">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-sm font-semibold">{t("views.installed")}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{packages.length}</span>
            </div>

            {error ? (
              <div className="py-10 text-center text-sm text-destructive">{error}</div>
            ) : loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">{t("state.loading")}</div>
            ) : packages.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">{t("state.noInstalledPiPackages")}</div>
            ) : (
              <div data-installed-list="pi-packages" className="divide-y divide-border/55">
                {packages.map((record) => {
                  const counts = resourceCounts(record);
                  const changing = changingId === record.id;
                  const managed = record.managed !== false;
                  return (
                    <div key={record.id} className="flex min-w-0 items-center gap-3 py-4">
                      <PluginIcon name={record.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{record.name}</span>
                          {record.version && <span className="shrink-0 text-xs text-muted-foreground">v{record.version}</span>}
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                          <span className="max-w-full truncate">{record.source}</span>
                          {counts.map((count) => <span key={count} className="shrink-0">{count}</span>)}
                        </div>
                      </div>
                      <Badge variant="outline" className={statusClass(record.status)}>
                        {t(`packages.status.${record.status}`)}
                      </Badge>
                      {managed ? (
                        <Switch
                          checked={record.enabled}
                          disabled={changing}
                          aria-label={t("packages.toggle", { name: record.name })}
                          onCheckedChange={(enabled) => void setEnabled(record, enabled)}
                        />
                      ) : (
                        <Badge variant="secondary" className="max-w-24 truncate text-[10px]">
                          {t("packages.origin.userPi")}
                        </Badge>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={t("packages.details")}
                            onClick={() => setSelected(record)}
                          >
                            <Info className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("packages.details")}</TooltipContent>
                      </Tooltip>
                      {managed && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive"
                              disabled={changing}
                              aria-label={t("action.remove")}
                              onClick={() => void remove(record)}
                            >
                              {changing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("action.remove")}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      <Dialog open={installOpen} onOpenChange={(open) => open || closeInstall()}>
        <DialogContent className="rounded-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("packages.add")}</DialogTitle>
            <DialogDescription>{t("packages.installDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="pi-package-source" className="text-xs font-medium">{t("packages.source")}</label>
              <Input
                id="pi-package-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={t("packages.sourcePlaceholder")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-xs leading-5 text-muted-foreground">{t("packages.sourceHint")}</p>
            </div>

            {reviewUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void window.claude.openExternal(reviewUrl)}
              >
                <ExternalLink className="h-4 w-4" />
                {t("packages.reviewSource")}
              </Button>
            )}

            <div className="rounded-md border border-amber-500/35 bg-amber-500/8 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:text-amber-100">
              {t("packages.securityNotice")}
            </div>

            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/35 px-3 py-2.5">
              <Switch
                id="pi-package-reviewed"
                size="sm"
                checked={reviewed}
                onCheckedChange={setReviewed}
                aria-label={t("packages.reviewed")}
              />
              <label htmlFor="pi-package-reviewed" className="cursor-pointer text-xs leading-5 text-foreground">
                {t("packages.reviewed")}
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeInstall} disabled={installing}>
              {t("action.cancel")}
            </Button>
            <Button type="button" onClick={() => void install()} disabled={installing || !source.trim() || !reviewed}>
              {installing && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("action.confirmInstall")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="rounded-lg sm:max-w-lg">
          <DialogHeader>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>{selected?.name}</DialogTitle>
                <DialogDescription className="mt-1 break-all">{selected?.source}</DialogDescription>
              </div>
              {selected?.reviewUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("packages.reviewSource")}
                      onClick={() => void window.claude.openExternal(selected.reviewUrl!)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("packages.reviewSource")}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3 text-sm">
              <span>{selected?.managed === false ? t("packages.origin.userPi") : t("packages.statusLabel")}</span>
              {selected && (
                <Badge variant="outline" className={statusClass(selected.status)}>
                  {t(`packages.status.${selected.status}`)}
                </Badge>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-medium">{t("packages.resources")}</div>
              {selected?.resources.length ? (
                <div className="max-h-48 divide-y divide-border/55 overflow-y-auto rounded-md border border-border/70">
                  {selected.resources.map((resource) => (
                    <div key={`${resource.kind}:${resource.path}`} className="min-w-0 px-3 py-2">
                      <div className="text-xs font-medium">{resource.kind}</div>
                      <div className="mt-0.5 break-all text-[11px] leading-4 text-muted-foreground">{resource.relativePath}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("packages.noResources")}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSelected(null)}>{t("action.cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
