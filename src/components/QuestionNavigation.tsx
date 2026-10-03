import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import type { QuestionEntry } from "@/lib/chat/question-navigation";
import { cn } from "@/lib/utils";

interface QuestionNavigationProps {
  entries: QuestionEntry[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  hydratedFrom: number;
  bottomInset: number;
  onNavigate: (id: string) => void;
}

export const QuestionNavigation = memo(function QuestionNavigation({
  entries, scrollContainerRef, hydratedFrom, bottomInset, onNavigate,
}: QuestionNavigationProps) {
  const { t } = useTranslation("chat");
  const [activeId, setActiveId] = useState<string>();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || entries.length < 2) return;
    const elements = [...container.querySelectorAll<HTMLElement>("[data-question-id]")];
    let frame = 0;
    const update = () => {
      frame = 0;
      if (elements.length === 0) return;
      const anchor = container.getBoundingClientRect().top + 80;
      // User rows are in document order; avoid measuring every row on scroll.
      let low = 0;
      let high = elements.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (elements[mid].getBoundingClientRect().top <= anchor) low = mid;
        else high = mid - 1;
      }
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 2;
      setActiveId(elements[atBottom ? elements.length - 1 : low].dataset.questionId);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    container.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [entries, hydratedFrom, scrollContainerRef]);

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !active) return;
    // Scroll only the rail, never its containing chat or split pane.
    const top = active.offsetTop;
    if (top < nav.scrollTop) nav.scrollTop = top;
    else if (top + active.offsetHeight > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = top + active.offsetHeight - nav.clientHeight;
    }
  }, [activeId]);

  if (entries.length < 2) return null;

  return (
    <div
      className="pointer-events-none absolute start-0 top-16 z-[6] flex w-9 items-center"
      style={{ bottom: Math.max(24, bottomInset + 24) }}
    >
      <TooltipProvider delayDuration={120}>
        <nav
          ref={navRef}
          aria-label={t("questionNavigation.label")}
          data-slot="question-navigation"
          className="pointer-events-auto relative max-h-[min(100%,18rem)] w-full overflow-y-auto overscroll-contain py-1 scrollbar-none"
        >
          {entries.map((entry, index) => {
            const preview = entry.text || t("questionNavigation.attachmentOnly");
            const label = t("questionNavigation.question", { number: index + 1 });
            const active = entry.id === activeId;
            return (
              <Tooltip key={entry.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-question-target={entry.id}
                    aria-label={`${label}: ${preview}`}
                    aria-current={active ? "location" : undefined}
                    onClick={() => onNavigate(entry.id)}
                    className="group flex h-3 w-full items-center px-1.5 outline-none focus-visible:rounded focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "h-0.5 rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none",
                        active ? "w-6 bg-foreground/80" : "w-3 bg-foreground/20 group-hover:w-5 group-hover:bg-foreground/50 group-focus-visible:w-5",
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={8}
                  collisionPadding={16}
                  className="max-w-[min(20rem,calc(100vw-4rem))] rounded-xl border border-border/60 bg-popover px-3.5 py-3 text-popover-foreground shadow-lg [&_svg]:hidden!"
                >
                  <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
                  <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-relaxed wrap-anywhere">{preview}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </TooltipProvider>
    </div>
  );
});
