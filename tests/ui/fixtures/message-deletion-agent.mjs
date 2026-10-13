import readline from "node:readline";
import fs from "node:fs";

// Deterministic custom ACP agent: no provider, credentials, network or native Pi edits.
const [releasePath, promptLogPath] = process.argv.slice(2);
let pendingPrompt;
let permissionPrompt;
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const result = (id, value) => send({ id, result: value });
const update = (value) => send({ method: "session/update", params: { sessionId: "fixture-session", update: value } });
const finish = () => {
  if (!pendingPrompt) return;
  const id = pendingPrompt;
  pendingPrompt = undefined;
  result(id, { stopReason: "end_turn" });
};
setInterval(() => { if (fs.existsSync(releasePath)) finish(); }, 50).unref();

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === "fixture-permission" && permissionPrompt) {
    result(permissionPrompt, { stopReason: "end_turn" });
    permissionPrompt = undefined;
    return;
  }
  switch (request.method) {
    case "initialize":
      result(request.id, { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "Message deletion fixture", version: "1.0.0" }, authMethods: [] });
      break;
    case "session/new":
      result(request.id, { sessionId: "fixture-session" });
      break;
    case "session/prompt": {
      const text = request.params.prompt.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      fs.appendFileSync(promptLogPath, `${text}\n`);
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Fixture streamed answer" } });
      if (text.includes("permission")) {
        permissionPrompt = request.id;
        send({ id: "fixture-permission", method: "session/request_permission", params: {
          sessionId: "fixture-session",
          toolCall: { toolCallId: "fixture-tool", title: "Fixture permission", kind: "read", status: "pending", rawInput: { path: "/tmp/fixture.txt" } },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }],
        } });
      } else {
        pendingPrompt = request.id;
        if (fs.existsSync(releasePath)) finish();
      }
      break;
    }
    case "session/cancel":
      if (pendingPrompt) result(pendingPrompt, { stopReason: "cancelled" });
      if (permissionPrompt) result(permissionPrompt, { stopReason: "cancelled" });
      pendingPrompt = undefined;
      permissionPrompt = undefined;
      break;
    default:
      if (request.id !== undefined) send({ id: request.id, error: { code: -32601, message: "Method not found" } });
  }
});
