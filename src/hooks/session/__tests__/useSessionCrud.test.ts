import { describe, expect, it } from "vitest";
import type { ChatSession } from "@/types";
import { applySelectedSessionReadState } from "../useSessionCrud";

describe("applySelectedSessionReadState", () => {
  it("clears unread completion when a completed background session is selected", () => {
    const session: ChatSession = {
      id: "session-1",
      projectId: "project-1",
      title: "Background reply",
      createdAt: 1,
      totalCost: 0,
      isActive: false,
      hasUnreadCompletion: true,
      hasPendingPermission: true,
    };

    expect(applySelectedSessionReadState(session, "session-1")).toMatchObject({
      id: "session-1",
      isActive: true,
      hasUnreadCompletion: false,
      hasPendingPermission: false,
    });
  });

  it("keeps other sessions inactive without changing their unread state", () => {
    const session: ChatSession = {
      id: "session-2",
      projectId: "project-1",
      title: "Still unread",
      createdAt: 1,
      totalCost: 0,
      isActive: true,
      hasUnreadCompletion: true,
    };

    expect(applySelectedSessionReadState(session, "session-1")).toMatchObject({
      id: "session-2",
      isActive: false,
      hasUnreadCompletion: true,
    });
  });
});
