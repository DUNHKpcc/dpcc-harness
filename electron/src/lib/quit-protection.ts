export interface InterruptibleWorkSummary {
  agentTasks: number;
  terminals: number;
}

export interface QuitWarningCopy {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
  cancelLabel: string;
}

export function hasInterruptibleWork(summary: InterruptibleWorkSummary): boolean {
  return summary.agentTasks > 0 || summary.terminals > 0;
}

export function buildQuitWarningCopy(
  locale: string,
  summary: InterruptibleWorkSummary,
): QuitWarningCopy {
  const isChinese = locale.toLowerCase().startsWith("zh");
  if (isChinese) {
    const details = [
      summary.agentTasks > 0 ? `${summary.agentTasks} 个正在运行的 Agent 任务` : null,
      summary.terminals > 0 ? `${summary.terminals} 个终端进程` : null,
    ].filter(Boolean).join("、");
    return {
      title: "退出 PccAgent？",
      message: "退出会中断仍在运行的任务",
      detail: `${details}将在退出时被停止。未完成的输出无法在下次启动后继续。`,
      confirmLabel: "退出并中断",
      cancelLabel: "取消",
    };
  }

  const details = [
    summary.agentTasks > 0
      ? `${summary.agentTasks} running Agent task${summary.agentTasks === 1 ? "" : "s"}`
      : null,
    summary.terminals > 0
      ? `${summary.terminals} terminal process${summary.terminals === 1 ? "" : "es"}`
      : null,
  ].filter(Boolean).join(" and ");
  return {
    title: "Quit PccAgent?",
    message: "Quitting will interrupt running work",
    detail: `${details} will be stopped. Incomplete output cannot continue after the next launch.`,
    confirmLabel: "Quit and interrupt",
    cancelLabel: "Cancel",
  };
}
