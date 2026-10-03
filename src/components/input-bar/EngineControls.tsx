import type { AcpPermissionBehavior } from "@/types";
import { PermissionBehaviorPicker } from "@/components/PermissionBehaviorPicker";

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
  return (
    <PermissionBehaviorPicker
      value={acpPermissionBehavior ?? "ask"}
      onChange={onAcpPermissionBehaviorChange}
      variant="dropdown"
      disabled={disabled}
    />
  );
}
