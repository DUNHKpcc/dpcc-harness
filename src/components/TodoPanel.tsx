import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, ListChecks, Circle, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import type { TodoItem } from "@/types";
import { getTodoItems } from "@/lib/chat/todo-utils";

interface TodoPanelProps {
  todos: TodoItem[];
  onClose?: () => void;
}

export function TodoPanel({ todos, onClose }: TodoPanelProps) {
  const { t } = useTranslation("tools");
  const items = getTodoItems(todos);
  const completed = items.filter((t) => t.status === "completed").length;
  const total = items.length;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        icon={ListChecks}
        label={t("todos.title")}
        separator={false}
        iconClass="text-blue-600/70 dark:text-blue-200/50"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-foreground/40">
            {completed}/{total}
          </span>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground/55 hover:text-foreground"
              aria-label={t("todos.close")}
              title={t("todos.close")}
              onClick={onClose}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </PanelHeader>

      {/* Thin progress bar */}
      <div className="mx-3 mt-0.5 mb-1.5 h-px rounded-full bg-foreground/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            completed === total && total > 0
              ? "bg-emerald-400/60"
              : "bg-blue-400/50"
          }`}
          style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-1.5 pb-1.5 space-y-px">
          {items.map((todo, i) => {
            const isActive = todo.status === "in_progress";
            const isDone = todo.status === "completed";

            return (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-md px-2 py-1 transition-colors ${
                  isActive ? "bg-blue-500/[0.04]" : ""
                }`}
              >
                {/* Status icon */}
                <div className="mt-[2px] shrink-0">
                  {isDone ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/60" />
                  ) : isActive ? (
                    <Loader2 className="h-3.5 w-3.5 text-blue-400/70 animate-spin" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-foreground/15" />
                  )}
                </div>

                {/* Task text */}
                <span
                  className={`text-[13px] leading-snug ${
                    isDone
                      ? "text-foreground/35 line-through decoration-foreground/15"
                      : isActive
                        ? "text-foreground/80 font-medium"
                        : "text-foreground/55"
                  }`}
                >
                  {isActive && todo.activeForm ? todo.activeForm : todo.content}
                </span>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
