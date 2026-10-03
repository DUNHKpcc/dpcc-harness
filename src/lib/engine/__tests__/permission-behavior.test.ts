import { describe, expect, it } from "vitest";
import { pickAutoResponseOption } from "../acp-adapter";

const once = { optionId: "once", kind: "allow_once" };
const always = { optionId: "always", kind: "allow_always" };
const reject = { optionId: "deny", kind: "reject_once" };

describe("permission behavior matches the UI explanations", () => {
  it("Ask leaves every request to the user", () => {
    expect(pickAutoResponseOption([once, always], "ask")).toBeNull();
  });
  it("Auto Accept chooses only single-use approval and otherwise asks", () => {
    expect(pickAutoResponseOption([always, once], "auto_accept")).toBe("once");
    expect(pickAutoResponseOption([always, reject], "auto_accept")).toBeNull();
  });
  it("Allow All prefers persistent approval and falls back to single-use approval", () => {
    expect(pickAutoResponseOption([once, always], "allow_all")).toBe("always");
    expect(pickAutoResponseOption([reject, once], "allow_all")).toBe("once");
    expect(pickAutoResponseOption([reject], "allow_all")).toBeNull();
    expect(pickAutoResponseOption([], "allow_all")).toBeNull();
  });
});
