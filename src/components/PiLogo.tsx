import { memo, type SVGProps } from "react";
import { cn } from "@/lib/utils";

interface PiLogoProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
}

/** Official compact Pi badge published in the Pi press kit at pi.dev/press-kit. */
export const PiLogo = memo(function PiLogo({
  size = 16,
  className,
  ...props
}: PiLogoProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 800 800"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-pi-logo="official-badge"
      className={cn("shrink-0 select-none", className)}
    >
      <rect width="800" height="800" rx="120" fill="#09090b" />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path fill="#fff" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
});
