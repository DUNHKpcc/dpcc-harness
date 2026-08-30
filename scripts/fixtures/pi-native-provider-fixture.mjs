import http from "node:http";

const DEFAULT_API_KEY = "pi-native-fixture-key";

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.setEncoding("utf8");
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(chunks.join("")));
    request.on("error", reject);
  });
}

function writeSseResponse(response, text) {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "content-type": "text/event-stream",
  });
  response.write(`data: ${JSON.stringify({
    id: "pi-native-fixture-response",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    id: "pi-native-fixture-response",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}\n\n`);
  response.end("data: [DONE]\n\n");
}

function writeFailureResponse(response) {
  response.writeHead(503, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { type: "fixture_unavailable", message: "local fixture failure" } }));
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
}

export async function startPiNativeProviderFixture({ mode = "success", apiKey = DEFAULT_API_KEY } = {}) {
  const requests = [];
  let requestCount = 0;

  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { type: "not_found" } }));
      return;
    }

    const body = await readRequestBody(request);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { type: "invalid_json" } }));
      return;
    }

    requestCount += 1;
    requests.push({
      count: requestCount,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
      model: typeof payload.model === "string" ? payload.model : "",
      toolNames: Array.isArray(payload.tools)
        ? payload.tools
          .map((tool) => tool?.function?.name)
          .filter((name) => typeof name === "string")
        : [],
      messageText: Array.isArray(payload.messages)
        ? payload.messages.map(messageText).filter(Boolean).join("\n")
        : "",
    });

    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { type: "unauthorized" } }));
      return;
    }

    if (mode === "disconnect" || (mode === "recover" && requestCount === 1)) {
      request.socket.destroy();
      return;
    }
    if (mode === "http-failure") {
      writeFailureResponse(response);
      return;
    }

    const text = mode === "recover"
      ? "Native provider recovered after retry."
      : "Native provider success.";
    writeSseResponse(response, text);
  });

  server.on("clientError", (error, socket) => {
    socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("fixture did not receive a TCP address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    get requestCount() {
      return requestCount;
    },
    mode,
    requests,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
