import { describe, expect, it } from "vitest";
import { AcpRendererBridge, type AcpRendererDelivery } from "../acp-renderer-bridge";

describe("AcpRendererBridge", () => {
  it("replays pre-attach deliveries once and preserves their order", () => {
    const bridge = new AcpRendererBridge();
    const received: AcpRendererDelivery[] = [];
    const sink = (delivery: AcpRendererDelivery) => received.push(delivery);
    bridge.open("session-1");

    bridge.deliver("session-1", { channel: "acp:event", payload: { text: "first" } }, sink);
    bridge.deliver("session-1", { channel: "acp:turn_complete", payload: { stopReason: "end_turn" } }, sink);

    expect(received).toEqual([]);
    expect(bridge.attach("session-1", sink)).toBe(2);
    expect(received).toEqual([
      { channel: "acp:event", payload: { text: "first" } },
      { channel: "acp:turn_complete", payload: { stopReason: "end_turn" } },
    ]);
    expect(bridge.attach("session-1", sink)).toBe(0);
    expect(received).toHaveLength(2);
  });

  it("delivers live events immediately after attachment", () => {
    const bridge = new AcpRendererBridge();
    const received: AcpRendererDelivery[] = [];
    const sink = (delivery: AcpRendererDelivery) => received.push(delivery);
    bridge.open("session-1");
    bridge.attach("session-1", sink);

    bridge.deliver("session-1", { channel: "acp:event", payload: { text: "live" } }, sink);

    expect(received).toEqual([
      { channel: "acp:event", payload: { text: "live" } },
    ]);
  });

  it("buffers again while an existing transport waits for renderer reattachment", () => {
    const bridge = new AcpRendererBridge();
    const received: AcpRendererDelivery[] = [];
    const sink = (delivery: AcpRendererDelivery) => received.push(delivery);
    bridge.open("session-1");
    bridge.attach("session-1", sink);

    expect(bridge.detach("session-1")).toBe(true);
    bridge.deliver("session-1", { channel: "acp:event", payload: { text: "after-reload" } }, sink);
    expect(received).toEqual([]);

    expect(bridge.attach("session-1", sink)).toBe(1);
    expect(received).toEqual([
      { channel: "acp:event", payload: { text: "after-reload" } },
    ]);
  });

  it("unblocks a pending first prompt when the renderer attaches", async () => {
    const bridge = new AcpRendererBridge(100);
    bridge.open("session-1");
    const ready = bridge.waitUntilAttached("session-1");

    bridge.attach("session-1", () => undefined);

    await expect(ready).resolves.toBeUndefined();
  });

  it("rejects a pending first prompt when the session closes", async () => {
    const bridge = new AcpRendererBridge(100);
    bridge.open("session-1");
    const ready = bridge.waitUntilAttached("session-1");

    bridge.close("session-1");

    await expect(ready).rejects.toThrow("ACP session closed");
  });
});
