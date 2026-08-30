import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Download, Globe2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PiLogo } from "@/components/PiLogo";
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
import { PluginIcon, skillPublisherIconUrl } from "./PluginIcon";
import type {
  CatalogFreshness,
  InstalledSkillRecord,
  SkillCatalogItem,
} from "@/types";

function formatInstalls(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function SkillsCatalog() {
  const { t } = useTranslation("plugins");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SkillCatalogItem[]>([]);
  const [installed, setInstalled] = useState<InstalledSkillRecord[]>([]);
  const [freshness, setFreshness] = useState<CatalogFreshness>("fresh");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillCatalogItem | null>(null);
  const [installing, setInstalling] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const trimmedQuery = query.trim();
  const catalogQuery = trimmedQuery.length >= 2 ? trimmedQuery : "";

  const refreshInstalled = useCallback(async () => {
    const response = await window.claude.plugins.skills.listInstalled();
    if ("error" in response) {
      setError(response.error);
      return;
    }
    setInstalled(response.items);
  }, []);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void window.claude.plugins.skills.search(catalogQuery).then((response) => {
        if (cancelled) return;
        if ("error" in response) {
          setError(response.error);
          setItems([]);
        } else {
          setItems(response.items);
          setFreshness(response.freshness);
        }
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, catalogQuery ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalogQuery]);

  const installedCatalogIds = useMemo(
    () => new Set(installed.map((record) => record.catalogId)),
    [installed],
  );

  const openInstall = useCallback((item: SkillCatalogItem) => {
    setSelected(item);
    setConfirmOverwrite(false);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!selected) return;
    setInstalling(true);
    const response = await window.claude.plugins.skills.install({
      catalogId: selected.id,
      name: selected.name,
      source: selected.source,
      scope: "global",
      targets: ["pi"],
      allowOverwriteModified: confirmOverwrite,
    });
    setInstalling(false);
    if ("error" in response) {
      if (response.requiresConfirmation) {
        setConfirmOverwrite(true);
        return;
      }
      toast.error(response.error);
      return;
    }
    toast.success(t("skills.installSuccess", { name: selected.name }));
    setSelected(null);
    await refreshInstalled();
  }, [confirmOverwrite, refreshInstalled, selected, t]);

  const handleRemove = useCallback(async (record: InstalledSkillRecord) => {
    setRemovingId(record.id);
    const response = await window.claude.plugins.skills.remove(record.id);
    setRemovingId(null);
    if (response.error) {
      toast.error(response.error);
      return;
    }
    toast.success(t("skills.removeSuccess", { name: record.name }));
    await refreshInstalled();
  }, [refreshInstalled, t]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div
          data-skill-catalog-layout="reference"
          className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:px-8"
        >
          <header>
            <h1 className="text-2xl font-semibold text-foreground">{t("tabs.skills")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("skills.subtitle")}</p>
            <label className="relative mt-7 block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("search.skills")}
                className="h-11 rounded-full border-border/80 bg-background pl-11 pr-4 text-sm shadow-none"
              />
            </label>
          </header>

          <section data-installed-strip="skills" className="mt-9">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-sm font-semibold">{t("views.installed")}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{installed.length}</span>
            </div>
            {installed.length === 0 ? (
              <p className="py-5 text-sm text-muted-foreground">{t("state.noInstalledSkills")}</p>
            ) : (
              <div
                data-installed-list="skills"
                className="grid max-h-[156px] grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3 overflow-y-auto overscroll-contain py-4 pr-1"
              >
                {installed.map((record) => (
                  <div
                    key={record.id}
                    className="flex h-14 min-w-0 items-center gap-3 rounded-md border border-border/65 bg-background px-2.5"
                  >
                    <PluginIcon
                      name={record.name}
                      imageUrl={skillPublisherIconUrl(record.source)}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{record.name}</div>
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {record.managed === false ? record.origin : t("skills.global")}
                        {" · "}
                        {record.managed === false ? t("skills.localReadOnly") : t("skills.pi")}
                      </div>
                    </div>
                    {record.managed !== false && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={removingId === record.id}
                        onClick={() => void handleRemove(record)}
                        title={t("action.remove")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mt-8">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-sm font-semibold">
                {t(catalogQuery ? "views.searchResults" : "views.trending")}
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {freshness === "stale" ? t("source.stale") : t("source.skills")}
              </span>
            </div>

            {error ? (
              <div className="py-12 text-center text-sm text-destructive">{error}</div>
            ) : loading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{t("state.loading")}</div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{t("state.empty")}</div>
            ) : (
              <div
                data-plugin-catalog-grid="skills"
                className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,21rem),1fr))] gap-x-10"
              >
                {items.map((item) => {
                  const isInstalled = installedCatalogIds.has(item.id);
                  return (
                    <div key={item.id} className="flex min-h-24 items-center gap-3 border-b border-border/55 py-4">
                      <PluginIcon
                        name={item.name}
                        imageUrl={item.iconUrl ?? skillPublisherIconUrl(item.source)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{item.name}</span>
                          {isInstalled && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                        </div>
                        <div className="mt-1 min-w-0 text-xs text-muted-foreground">
                          <div className="truncate">{item.source}</div>
                          <div className="mt-0.5">{t("skills.installs", { count: formatInstalls(item.installs) })}</div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 rounded-full px-3"
                        disabled={!item.installable}
                        onClick={() => openInstall(item)}
                        title={!item.installable ? t("skills.unsupportedSource") : undefined}
                      >
                        {t(isInstalled ? "action.update" : "action.install")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setConfirmOverwrite(false);
          }
        }}
      >
        <DialogContent className="rounded-lg sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>{selected?.source}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {confirmOverwrite && (
              <div className="rounded-md border border-amber-500/35 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
                {t("skills.modifiedConfirmation")}
              </div>
            )}
            <div>
              <div className="mb-2 text-xs font-medium">{t("skills.location")}</div>
              <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <Globe2 className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t("skills.global")}</div>
                  <div className="text-xs text-muted-foreground">{t("skills.globalDescription")}</div>
                </div>
                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium">{t("skills.targets")}</div>
              <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3">
                <PiLogo className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">{t("skills.pi")}</span>
                <Check className="ml-auto h-4 w-4 text-emerald-600" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelected(null);
                setConfirmOverwrite(false);
              }}
            >
              {t("action.cancel")}
            </Button>
            <Button
              onClick={() => void handleInstall()}
              disabled={installing}
            >
              <Download className="h-4 w-4" />
              {t(confirmOverwrite ? "action.replaceModified" : "action.confirmInstall")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
