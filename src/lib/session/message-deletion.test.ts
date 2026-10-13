import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import { canDeleteMessage, getMessageDeletionPlan, restoreDeletedMessages } from "./message-deletion";

const user: UIMessage = { id: "user", role: "user", content: "Question", timestamp: 1 };
const answer: UIMessage = { id: "answer", role: "assistant", content: "Answer", timestamp: 2 };
const thinking: UIMessage = { ...answer, id: "thinking", content: "", thinking: "Reasoning" };
const tool: UIMessage = { id: "tool", role: "tool_call", content: "", timestamp: 3 };
const result: UIMessage = { ...tool, id: "result", role: "tool_result" };
const queued: UIMessage = { ...user, id: "queued", isQueued: true };
const nextUser: UIMessage = { ...user, id: "next-user" };
const nextAnswer: UIMessage = { ...answer, id: "next-answer" };

const ids = (messages: UIMessage[]) => messages.map((message) => message.id);

describe("local message deletion boundaries", () => {
  it("only allows idle user and assistant messages", () => {
    expect(canDeleteMessage(user, false)).toBe(true);
    expect(canDeleteMessage(answer, false)).toBe(true);
    for (const role of ["tool_call", "tool_result", "system", "summary"] as const) {
      expect(canDeleteMessage({ ...user, role }, false)).toBe(false);
    }
    expect(canDeleteMessage(user, true)).toBe(false);
    expect(canDeleteMessage(answer, true)).toBe(false);
    expect(canDeleteMessage({ ...answer, isStreaming: true }, false)).toBe(false);
    expect(canDeleteMessage(queued, true)).toBe(true);
  });

  it.each(["thinking", "answer"])("deletes the entire reply from its %s entry while preserving questions, neighbors and queued messages", (id) => {
    const messages = [nextUser, nextAnswer, user, thinking, tool, queued, result,
      { ...tool, id: "system", role: "system" as const },
      { ...tool, id: "summary", role: "summary" as const }, answer,
      { ...nextUser, id: "last-user" }, { ...nextAnswer, id: "last-answer" }];
    const plan = getMessageDeletionPlan(messages, id);
    expect(ids(plan.deleted)).toEqual(["thinking", "tool", "result", "system", "summary", "answer"]);
    expect(ids(plan.next)).toEqual(["next-user", "next-answer", "user", "queued", "last-user", "last-answer"]);
  });

  it("keeps the reply boundary after deleting its user question and reloading", () => {
    const plan = getMessageDeletionPlan([user, answer, nextUser, thinking, tool, result, nextAnswer], "next-user");
    expect(ids(plan.deleted)).toEqual(["next-user"]);
    const reloaded = JSON.parse(JSON.stringify(plan.next)) as UIMessage[];
    expect(ids(getMessageDeletionPlan(reloaded, "next-answer").next)).toEqual(["user", "answer"]);
    expect(ids(getMessageDeletionPlan(reloaded, "answer").next)).toEqual(["user", "thinking", "tool", "result", "next-answer"]);
  });

  it("handles old records with no preceding question, and never deletes queued/tool/system entries directly", () => {
    expect(getMessageDeletionPlan([thinking, tool, answer, nextUser, nextAnswer], "answer").next).toEqual([nextUser, nextAnswer]);
    for (const id of ["queued", "tool", "missing"]) {
      expect(getMessageDeletionPlan([user, tool, queued, answer], id).deleted).toEqual([]);
    }
  });

  it("restores a whole failed reply in order without dropping new or queued messages", () => {
    const original = [user, thinking, tool, queued, result, answer, nextUser, nextAnswer];
    const { deleted, next } = getMessageDeletionPlan(original, "answer");
    const newer = { ...user, id: "new" };
    expect(restoreDeletedMessages([...next, newer], deleted, original)).toEqual([...original, newer]);
    expect(restoreDeletedMessages(original, deleted, original)).toEqual(original);
    const tail = [user, thinking, tool, result, answer];
    const tailPlan = getMessageDeletionPlan(tail, "answer");
    expect(restoreDeletedMessages([user, newer], tailPlan.deleted, tail)).toEqual([...tail, newer]);
    expect(restoreDeletedMessages([newer], [answer], [answer])).toEqual([answer, newer]);
  });
});
