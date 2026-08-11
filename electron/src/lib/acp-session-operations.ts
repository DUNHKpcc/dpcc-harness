interface QueuedOperation {
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  settlesFirstUserPrompt: boolean;
  requiresFirstUserPrompt: boolean;
}

/**
 * Serializes prompts sharing one ACP connection. User turns have priority, and
 * utility prompts cannot overtake the first turn of a newly-created chat.
 */
export class AcpSessionOperationCoordinator {
  private readonly userQueue: QueuedOperation[] = [];
  private readonly utilityQueue: QueuedOperation[] = [];
  private userPromptStarted = false;
  private firstUserPromptSettled = false;
  private running = false;
  private closedError: Error | null = null;

  runUserPrompt<T>(operation: () => Promise<T>): Promise<T> {
    const settlesFirstUserPrompt = !this.userPromptStarted;
    this.userPromptStarted = true;
    return this.enqueue(this.userQueue, operation, settlesFirstUserPrompt);
  }

  runUtilityPrompt<T>(operation: () => Promise<T>, waitForFirstUserPrompt = false): Promise<T> {
    return this.enqueue(this.utilityQueue, operation, false, waitForFirstUserPrompt);
  }

  close(reason = "ACP session closed."): void {
    if (this.closedError) return;
    this.closedError = new Error(reason);
    for (const queued of [...this.userQueue.splice(0), ...this.utilityQueue.splice(0)]) {
      queued.reject(this.closedError);
    }
  }

  private enqueue<T>(
    queue: QueuedOperation[],
    operation: () => Promise<T>,
    settlesFirstUserPrompt: boolean,
    requiresFirstUserPrompt = false,
  ): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise<T>((resolve, reject) => {
      queue.push({
        operation,
        resolve: (value) => resolve(value as T),
        reject,
        settlesFirstUserPrompt,
        requiresFirstUserPrompt,
      });
      this.drain();
    });
  }

  private drain(): void {
    if (this.running || this.closedError) return;
    const utilityIndex = this.utilityQueue.findIndex((queued) => (
      !queued.requiresFirstUserPrompt || this.firstUserPromptSettled
    ));
    const next = this.userQueue.shift()
      ?? (utilityIndex >= 0 ? this.utilityQueue.splice(utilityIndex, 1)[0] : undefined);
    if (!next) return;

    this.running = true;
    void next.operation().then(next.resolve, next.reject).finally(() => {
      if (next.settlesFirstUserPrompt) {
        this.firstUserPromptSettled = true;
      }
      this.running = false;
      this.drain();
    });
  }
}
