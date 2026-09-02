import { memo } from "react";
import { Bot } from "lucide-react";
import baichuanIcon from "@lobehub/icons-static-svg/icons/baichuan.svg?url";
import claudeIcon from "@lobehub/icons-static-svg/icons/claude.svg?url";
import cohereIcon from "@lobehub/icons-static-svg/icons/cohere.svg?url";
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek.svg?url";
import doubaoIcon from "@lobehub/icons-static-svg/icons/doubao.svg?url";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini.svg?url";
import gemmaIcon from "@lobehub/icons-static-svg/icons/gemma.svg?url";
import grokIcon from "@lobehub/icons-static-svg/icons/grok.svg?url";
import hunyuanIcon from "@lobehub/icons-static-svg/icons/hunyuan.svg?url";
import internlmIcon from "@lobehub/icons-static-svg/icons/internlm.svg?url";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi.svg?url";
import metaIcon from "@lobehub/icons-static-svg/icons/meta.svg?url";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax.svg?url";
import mistralIcon from "@lobehub/icons-static-svg/icons/mistral.svg?url";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg?url";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen.svg?url";
import sparkIcon from "@lobehub/icons-static-svg/icons/spark.svg?url";
import stepfunIcon from "@lobehub/icons-static-svg/icons/stepfun.svg?url";
import wenxinIcon from "@lobehub/icons-static-svg/icons/wenxin.svg?url";
import yiIcon from "@lobehub/icons-static-svg/icons/yi.svg?url";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu.svg?url";
import { cn } from "@/lib/utils";
import {
  getModelBrand,
  getModelDisplayName,
  type ModelBrand,
} from "@/lib/model-utils";

const MODEL_ICON_URLS: Record<ModelBrand, string> = {
  baichuan: baichuanIcon,
  claude: claudeIcon,
  cohere: cohereIcon,
  deepseek: deepseekIcon,
  doubao: doubaoIcon,
  gemini: geminiIcon,
  gemma: gemmaIcon,
  grok: grokIcon,
  hunyuan: hunyuanIcon,
  internlm: internlmIcon,
  kimi: kimiIcon,
  meta: metaIcon,
  minimax: minimaxIcon,
  mistral: mistralIcon,
  openai: openaiIcon,
  qwen: qwenIcon,
  spark: sparkIcon,
  stepfun: stepfunIcon,
  wenxin: wenxinIcon,
  yi: yiIcon,
  zhipu: zhipuIcon,
};

interface ModelIconProps {
  model: string;
  size?: number;
  className?: string;
}

export const ModelIcon = memo(function ModelIcon({
  model,
  size = 14,
  className,
}: ModelIconProps) {
  const brand = getModelBrand(model);
  if (!brand) {
    return (
      <Bot
        aria-hidden="true"
        data-model-brand="unknown"
        data-slot="model-icon"
        className={cn("shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  const iconUrl = MODEL_ICON_URLS[brand];
  return (
    <span
      aria-hidden="true"
      data-model-brand={brand}
      data-slot="model-icon"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url("${iconUrl}")`,
        maskImage: `url("${iconUrl}")`,
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
});

interface ModelLabelProps {
  model: string;
  label?: string;
  iconSize?: number;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
}

export const ModelLabel = memo(function ModelLabel({
  model,
  label,
  iconSize,
  className,
  iconClassName,
  labelClassName,
}: ModelLabelProps) {
  const displayLabel = label ?? getModelDisplayName(model);
  return (
    <span
      data-slot="model-label"
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      title={displayLabel}
    >
      <ModelIcon model={model} size={iconSize} className={iconClassName} />
      <span className={cn("min-w-0 truncate", labelClassName)}>{displayLabel}</span>
    </span>
  );
});
