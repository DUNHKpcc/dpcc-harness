import { memo } from "react";
import { cn } from "@/lib/utils";

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
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
});
