import { memo, type SyntheticEvent } from "react";
import { cn } from "@/lib/utils";

const EXTRA_RESOURCES_LOGO_SRC = "../../pcc-agent-logo.png";

function handleLogoLoadError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  if (image.dataset.extraResourcesFallback === "true") return;
  image.dataset.extraResourcesFallback = "true";
  image.src = EXTRA_RESOURCES_LOGO_SRC;
}

export const PccAgentLogo = memo(function PccAgentLogo({
  className,
  alt = "",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="icon.png"
      alt={alt}
      draggable={false}
      data-pcc-agent-logo
      data-extra-resources-src={EXTRA_RESOURCES_LOGO_SRC}
      onError={handleLogoLoadError}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
});
