import { memo, useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ExternalLink, Github, Scale, Heart, History } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader } from "@/components/settings/shared";
import {
  INITIAL_RELEASE_HISTORY_LIMIT,
  RELEASE_HISTORY,
  isCurrentRelease,
  releaseTranslationKey,
} from "@/lib/release-history";

// ── PccAgent logo mark — app icon image ──

function PccAgentLogo({ className }: { className: string }) {
  return (
    <img
      src="icon.png"
      alt="PccAgent"
      className={className}
    />
  );
}

// ── Link row component ──

function AboutLink({
  icon: Icon,
  label,
  href,
  description,
}: {
  icon: typeof ExternalLink;
  label: string;
  href: string;
  description: string;
}) {
  const handleClick = () => {
    window.open(href, "_blank");
  };

  return (
    <button
      onClick={handleClick}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-foreground/[0.04] active:bg-foreground/[0.06]"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.05] transition-colors group-hover:bg-foreground/[0.08]">
        <Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground/80" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
    </button>
  );
}

const ReleaseHistorySection = memo(function ReleaseHistorySection({
  currentVersion,
}: {
  currentVersion: string;
}) {
  const { t, i18n } = useTranslation("settings");
  const [expandedVersion, setExpandedVersion] = useState(RELEASE_HISTORY[0]?.version ?? "");
  const [showAll, setShowAll] = useState(false);
  const visibleReleases = showAll
    ? RELEASE_HISTORY
    : RELEASE_HISTORY.slice(0, INITIAL_RELEASE_HISTORY_LIMIT);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }), [i18n.language]);

  return (
    <section className="mt-6 border-t border-foreground/[0.06] pt-4">
      <div className="flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("about.releaseHistory.title")}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("about.releaseHistory.description")}
      </p>

      <div className="mt-3 border-y border-foreground/[0.06]">
        {visibleReleases.map((release) => {
          const isExpanded = expandedVersion === release.version;
          const current = !!currentVersion && isCurrentRelease(release.version, currentVersion);
          const releaseKey = releaseTranslationKey(release.version);
          const panelId = `release-details-${releaseKey}`;

          return (
            <div key={release.version} className="border-b border-foreground/[0.05] last:border-b-0">
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-3 px-2 py-2 text-start transition-colors hover:bg-foreground/[0.035]"
                aria-expanded={isExpanded}
                aria-controls={panelId}
                onClick={() => setExpandedVersion((value) => value === release.version ? "" : release.version)}
              >
                <span className="text-[13px] font-semibold text-foreground">v{release.version}</span>
                {current ? (
                  <span className="rounded border border-foreground/[0.08] bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t("about.releaseHistory.current")}
                  </span>
                ) : null}
                <span className="ms-auto text-[11px] tabular-nums text-muted-foreground/70">
                  {dateFormatter.format(new Date(`${release.date}T00:00:00Z`))}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </button>

              {isExpanded ? (
                <div id={panelId} className="px-3 pb-4 ps-5">
                  <p className="text-[13px] font-medium text-foreground/90">
                    {t(`about.releaseHistory.entries.${releaseKey}.title`)}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {release.changeKeys.map((changeKey) => (
                      <li key={changeKey} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                        <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-foreground/25" />
                        <span>{t(`about.releaseHistory.entries.${releaseKey}.${changeKey}`)}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-foreground/60 transition-colors hover:text-foreground"
                    onClick={() => window.open(release.releaseUrl, "_blank")}
                  >
                    {t("about.releaseHistory.viewRelease")}
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {RELEASE_HISTORY.length > INITIAL_RELEASE_HISTORY_LIMIT ? (
        <button
          type="button"
          className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setShowAll((value) => !value)}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
          {showAll ? t("about.releaseHistory.showLess") : t("about.releaseHistory.showOlder")}
        </button>
      ) : null}
    </section>
  );
});

// ── Component ──

export const AboutSettings = memo(function AboutSettings() {
  const { t } = useTranslation("settings");
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    window.claude.updater.currentVersion()
      .then((currentVersion) => {
        if (!cancelled) setVersion(currentVersion);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader title={t("about.title")} description={t("about.description")} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-5">
          {/* ── App identity ── */}
          <div className="flex items-start gap-4">
            <PccAgentLogo className="h-12 w-12 shrink-0 text-foreground" />
            <div className="min-w-0">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                PccAgent
              </h3>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                {t("about.tagline")}
                <br />
                {t("about.taglineLine2")}
              </p>
              {version && (
                <span className="mt-2 inline-flex items-center rounded-md bg-foreground/[0.05] px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  v{version}
                </span>
              )}
            </div>
          </div>

          <ReleaseHistorySection currentVersion={version} />

          {/* ── Links section ── */}
          <div className="mt-6 border-t border-foreground/[0.06] pt-4">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("about.links")}
            </span>

            <div className="-mx-3 mt-2 flex flex-col gap-0.5">
              <AboutLink
                icon={Github}
                label={t("about.githubLabel")}
                href="https://github.com/DUNHKpcc/dpcc-harness"
                description={t("about.githubDesc")}
              />
              <AboutLink
                icon={Scale}
                label={t("about.licenseLabel")}
                href="https://github.com/DUNHKpcc/dpcc-harness/blob/main/LICENSE"
                description={t("about.licenseDesc")}
              />
            </div>
          </div>

          {/* ── Credits ── */}
          <div className="mt-4 border-t border-foreground/[0.06] pt-4">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("about.credits")}
            </span>

            <div className="mt-3 rounded-xl border border-foreground/[0.06] bg-muted/20 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <Heart className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span className="text-[13px] font-medium text-foreground/90">
                  {t("about.builtBy")}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {t("about.creditsBody")}
              </p>
            </div>
          </div>

          {/* ── Tech acknowledgments ── */}
          <div className="mt-4 border-t border-foreground/[0.06] pt-4 pb-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("about.builtWith")}
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                "Electron",
                "React",
                "TypeScript",
                "Tailwind CSS",
                "ShadCN",
                "Claude Agent SDK",
                "Agent Client Protocol",
              ].map((tech) => (
                <span
                  key={tech}
                  className="inline-flex rounded-md bg-foreground/[0.04] px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
