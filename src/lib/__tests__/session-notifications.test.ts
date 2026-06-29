import { describe, expect, it } from "vitest";
import { getSessionNotificationActor } from "../session-notifications";

describe("getSessionNotificationActor", () => {
  it("keeps Codex sessions tied to their actual model", () => {
    expect(getSessionNotificationActor({
      engine: "codex",
      model: "gpt-5",
    })).toBe("gpt-5");
  });

  it("maps Claude aliases to readable labels", () => {
    expect(getSessionNotificationActor({
      engine: "claude",
      model: "sonnet",
    })).toBe("Claude Sonnet");
  });

  it("falls back to the ACP agent name when there is no model", () => {
    expect(getSessionNotificationActor(
      { engine: "acp", model: undefined },
      { model: "", agentName: "Context7 Agent" },
    )).toBe("Context7 Agent");
  });
});
