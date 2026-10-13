import { useState, useCallback, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/** Shared compact interaction for actions below message bubbles and code blocks. */
export function MessageActionButton({
  className, onClick, ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-5 w-5 text-muted-foreground hover:text-foreground", className)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
      }}
    />
  );
}

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
}

export function CopyButton({ text, className, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const accessibleLabel = label ?? "Copy";

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <MessageActionButton
      className={className}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      onClick={() => { void handleCopy(); }}
    >
      {copied ? <Check className="h-2.5 w-2.5 text-foreground/60" /> : <Copy className="h-2.5 w-2.5" />}
    </MessageActionButton>
  );
}
