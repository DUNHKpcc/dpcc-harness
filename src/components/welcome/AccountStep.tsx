import { motion } from "motion/react";
import { AccountEntryScreen } from "@/components/AccountEntryScreen";
import type { WizardStepProps } from "./shared";

export function AccountStep({ onNext }: WizardStepProps) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-8 py-8">
      <motion.div
        className="w-full max-w-xl"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <AccountEntryScreen
          variant="welcome"
          onConnected={onNext}
          onContinueAsGuest={onNext}
        />
      </motion.div>
    </div>
  );
}
