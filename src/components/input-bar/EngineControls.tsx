import { ChevronDown, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AcpPermissionBehavior } from "@/types";
import { ACP_PERMISSION_BEHAVIORS, TOOLBAR_BTN } from "./constants";

/** ACP-only permission behavior control. Removed runtimes have no controls. */
export function AcpBehaviorDropdown({
  acpPermissionBehavior,
  onAcpPermissionBehaviorChange,
  disabled,
}: {
  acpPermissionBehavior: AcpPermissionBehavior | undefined;
  onAcpPermissionBehaviorChange: (behavior: AcpPermissionBehavior) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("input");
  const activeBehavior = ACP_PERMISSION_BEHAVIORS.find(
    (behavior) => behavior.id === acpPermissionBehavior,
  )?.id ?? "ask";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={TOOLBAR_BTN}
          disabled={disabled}
        >
          <Shield className="size-3" />
          {t(`control.acpBehavior.${activeBehavior}`)}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ACP_PERMISSION_BEHAVIORS.map((behavior) => (
          <DropdownMenuItem
            key={behavior.id}
            onClick={() => onAcpPermissionBehaviorChange(behavior.id)}
            className={behavior.id === acpPermissionBehavior ? "bg-accent" : ""}
          >
            <div>
              <div>{t(`control.acpBehavior.${behavior.id}`)}</div>
              <div className="text-[10px] text-muted-foreground">
                {t(`control.acpBehavior.${behavior.id}Desc`)}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
