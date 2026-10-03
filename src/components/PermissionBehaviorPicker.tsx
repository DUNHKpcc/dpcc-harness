import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ACP_PERMISSION_BEHAVIORS, TOOLBAR_BTN } from "@/components/input-bar/constants";
import type { AcpPermissionBehavior } from "@/types";
import { cn } from "@/lib/utils";

interface PermissionBehaviorPickerProps {
  value: AcpPermissionBehavior;
  onChange: (behavior: AcpPermissionBehavior) => void;
  variant?: "cards" | "dropdown";
  disabled?: boolean;
}

/** All permission entry points share copy and confirm before saving Allow All. */
export function PermissionBehaviorPicker({ value, onChange, variant = "cards", disabled }: PermissionBehaviorPickerProps) {
  const { t } = useTranslation("input");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const choose = (behavior: AcpPermissionBehavior) => {
    if (disabled || behavior === value) return;
    if (behavior === "allow_all") setConfirmOpen(true);
    else onChange(behavior);
  };

  const optionContent = (behavior: AcpPermissionBehavior) => (
    <div>
      <div>{t(`control.acpBehavior.${behavior}`)}</div>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t(`control.acpBehavior.${behavior}Desc`)}</p>
    </div>
  );

  return (
    <>
      {variant === "dropdown" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={openerRef}
              variant="ghost" size="xs" disabled={disabled}
              aria-label={`${t("permissionPolicy.title")}: ${t(`control.acpBehavior.${value}`)}`}
              className={TOOLBAR_BTN}
            >
              <Shield className="size-3" />
              {t(`control.acpBehavior.${value}`)}<ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start" className="w-64 max-w-[calc(100vw-2rem)]"
            onCloseAutoFocus={(event) => { if (confirmOpen) event.preventDefault(); }}
          >
            {ACP_PERMISSION_BEHAVIORS.map(({ id }) => (
              <DropdownMenuItem key={id} onSelect={() => choose(id)} className={id === value ? "bg-accent" : ""}>
                {optionContent(id)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div role="group" aria-label={t("permissionPolicy.title")} className="space-y-3">
          {ACP_PERMISSION_BEHAVIORS.map(({ id }) => (
            <button
              key={id} type="button" disabled={disabled} aria-pressed={value === id}
              onClick={(event) => { openerRef.current = event.currentTarget; choose(id); }}
              className={cn("w-full rounded-xl border px-4 py-3 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", value === id ? "border-foreground/60 bg-accent" : "border-border hover:bg-accent/50")}
            >{optionContent(id)}</button>
          ))}
        </div>
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); openerRef.current?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>{t("permissionPolicy.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("permissionPolicy.confirmDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelRef} variant="outline" onClick={() => setConfirmOpen(false)}>{t("permissionPolicy.cancel")}</Button>
            <Button variant="destructive" disabled={disabled} onClick={() => { onChange("allow_all"); setConfirmOpen(false); }}>{t("permissionPolicy.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
