export type AcpRendererChannel =
  | "acp:event"
  | "acp:turn_complete"
  | "acp:turn_transport_error";

export interface AcpRendererDelivery {
  channel: AcpRendererChannel;
  payload: unknown;
}

type DeliverySink = (delivery: AcpRendererDelivery) => void;

interface AttachWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RendererBridgeState {
  attached: boolean;
  queue: AcpRendererDelivery[];
  waiters: Set<AttachWaiter>;
}

const DEFAULT_ATTACH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFERED_DELIVERIES = 2_000;

/**
 * Coordinates ACP main-process events with renderer listener attachment.
 *
 * ACP agents can emit startup chunks immediately after session/new, before the
 * renderer has committed the DRAFT -> live-session transition. Buffering those
 * deliveries and gating the first prompt removes the previous timing dependency
 * on a fixed renderer delay.
 */
export class AcpRendererBridge {
  private readonly states = new Map<string, RendererBridgeState>();

  constructor(
    private readonly attachTimeoutMs = DEFAULT_ATTACH_TIMEOUT_MS,
    private readonly maxBufferedDeliveries = DEFAULT_MAX_BUFFERED_DELIVERIES,
  ) {}

  open(sessionId: string): void {
    this.close(sessionId, "ACP renderer bridge reopened.");
    this.states.set(sessionId, {
      attached: false,
      queue: [],
      waiters: new Set(),
    });
  }

  deliver(sessionId: string, delivery: AcpRendererDelivery, sink: DeliverySink): void {
    const state = this.states.get(sessionId);
    if (!state || state.attached) {
      sink(delivery);
      return;
    }

    if (state.queue.length >= this.maxBufferedDeliveries) {
      state.queue.shift();
    }
    state.queue.push(delivery);
  }

  attach(sessionId: string, sink: DeliverySink): number {
    const state = this.states.get(sessionId);
    if (!state) return 0;

    state.attached = true;
    const queued = state.queue.splice(0);
    for (const delivery of queued) sink(delivery);

    for (const waiter of state.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    state.waiters.clear();
    return queued.length;
  }

  detach(sessionId: string): boolean {
    const state = this.states.get(sessionId);
    if (!state) return false;
    state.attached = false;
    return true;
  }

  async waitUntilAttached(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) throw new Error("ACP renderer bridge is unavailable.");
    if (state.attached) return;

    await new Promise<void>((resolve, reject) => {
      const waiter: AttachWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          state.waiters.delete(waiter);
          reject(new Error("ACP renderer did not attach before the prompt timeout."));
        }, this.attachTimeoutMs),
      };
      state.waiters.add(waiter);
    });
  }

  close(sessionId: string, reason = "ACP session closed."): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    this.states.delete(sessionId);
    for (const waiter of state.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    state.waiters.clear();
  }

  closeAll(reason = "ACP sessions closed."): void {
    for (const sessionId of [...this.states.keys()]) {
      this.close(sessionId, reason);
    }
  }
}
