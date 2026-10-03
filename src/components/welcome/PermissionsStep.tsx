import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { PermissionBehaviorPicker } from "@/components/PermissionBehaviorPicker";
import type { PermissionsStepProps } from "./shared";

export function PermissionsStep({
  permissionBehavior,
  onPermissionBehaviorChange,
}: PermissionsStepProps) {
  const { t } = useTranslation("welcome");
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-8">
      <div className="m-auto flex w-full max-w-lg flex-col py-10">
        {/* Heading */}
        <motion.div
          className="mb-10 text-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h2
            className="text-5xl italic"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              color: "oklch(0.62 0.20 155)",
            }}
          >
            {t("permissionsStep.title")}
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            {t("permissionsStep.subtitle")}
          </p>
        </motion.div>

        <PermissionBehaviorPicker value={permissionBehavior} onChange={onPermissionBehaviorChange} />
      </div>
    </div>
  );
}
