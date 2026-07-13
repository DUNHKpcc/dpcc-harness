import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader } from "@/components/settings/shared";
import qqIcon from "@/assets/contact/qq-icon.png";
import qqSupportQr from "@/assets/contact/qq-support.png";
import telegramIcon from "@/assets/contact/tg-icon.png";
import telegramDevelopersQr from "@/assets/contact/telegram-developers.png";

export function ContactSettings() {
  const { t } = useTranslation("settings");

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader title={t("contact.title")} description={t("contact.description")} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-5">
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {t("contact.intro")}
          </p>

          <div className="mt-5 grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2">
            <figure className="flex h-full flex-col rounded-lg border border-foreground/[0.06] bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <img src={qqIcon} alt="" className="h-4 w-4" />
                <span>{t("contact.support.platform")}</span>
              </div>

              <div className="mx-auto mt-4 aspect-square w-full max-w-[232px] overflow-hidden rounded-md bg-white p-2 ring-1 ring-black/5">
                <img
                  src={qqSupportQr}
                  alt={t("contact.support.qrAlt")}
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              </div>

              <figcaption className="mt-4 text-center">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("contact.support.title")}
                </h3>
                <p className="mx-auto mt-1 max-w-[17rem] text-xs leading-relaxed text-muted-foreground">
                  {t("contact.support.description")}
                </p>
              </figcaption>
            </figure>

            <figure className="flex h-full flex-col rounded-lg border border-foreground/[0.06] bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <img src={telegramIcon} alt="" className="h-4 w-4" />
                <span>{t("contact.developers.platform")}</span>
              </div>

              <div className="mx-auto mt-4 aspect-square w-full max-w-[232px] overflow-hidden rounded-md bg-white p-2 ring-1 ring-black/5">
                <img
                  src={telegramDevelopersQr}
                  alt={t("contact.developers.qrAlt")}
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              </div>

              <figcaption className="mt-4 text-center">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("contact.developers.title")}
                </h3>
                <p className="mx-auto mt-1 max-w-[17rem] text-xs leading-relaxed text-muted-foreground">
                  {t("contact.developers.description")}
                </p>
              </figcaption>
            </figure>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
