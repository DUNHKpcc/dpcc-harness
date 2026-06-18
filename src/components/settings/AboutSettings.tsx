import { memo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Github, Scale, Heart } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader } from "@/components/settings/shared";

// ── PccAgent logo mark — app icon image ──

function PccAgentLogo({ className }: { className: string }) {
  return (
    <img
      src="/icon.png"
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

// ── Component ──

export const AboutSettings = memo(function AboutSettings() {
  const { t } = useTranslation("settings");
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    window.claude.updater.currentVersion().then(setVersion);
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
