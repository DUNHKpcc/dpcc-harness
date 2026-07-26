import http from "http";
import { URL } from "url";
import { log } from "./logger";
import { reportError } from "./error-utils";
import { ElectronOAuthClientProvider } from "./mcp-oauth-provider";
import { loadOAuthData } from "./mcp-oauth-store";

const OAUTH_LOOPBACK_HOST = "localhost";

export async function authenticateMcpServer(
  serverName: string,
  serverUrl: string,
): Promise<{ accessToken: string } | { error: string }> {
  // Dynamic import — @modelcontextprotocol/sdk is ESM-only
  const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");

  return new Promise((resolve) => {
    let resolved = false;
    let port = 0;
    let provider: ElectronOAuthClientProvider | null = null;
    let callbackServer: http.Server | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (callbackServer) {
        if (callbackServer.listening) {
          callbackServer.close();
        }
        callbackServer = null;
      }
    };

    const finish = (result: { accessToken: string } | { error: string }) => {
      if (resolved) return;
      resolved = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      cleanup();
      resolve(result);
    };

    // Timeout after 120 seconds
    timeout = setTimeout(() => {
      log("MCP_OAUTH", `Timeout waiting for OAuth callback for "${serverName}"`);
      finish({ error: "Authentication timed out. Please try again." });
    }, 120_000);

    // Start a temporary HTTP server to receive the OAuth callback
    callbackServer = http.createServer(async (req, res) => {
      try {
        let callbackUrl: URL;
        try {
          callbackUrl = new URL(
            req.url ?? "",
            `http://${OAUTH_LOOPBACK_HOST}:${port}`,
          );
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Invalid request");
          return;
        }

        if (callbackUrl.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const activeProvider = provider;
        if (!activeProvider) {
          res.writeHead(503, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authentication is still starting</h2><p>Please try again.</p></body></html>");
          return;
        }

        const code = callbackUrl.searchParams.get("code");
        const error = callbackUrl.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>");
          log("MCP_OAUTH", `OAuth error for "${serverName}": ${error}`);
          finish({ error: `OAuth error: ${error}` });
          return;
        }

        if (!code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Missing authorization code</h2><p>You can close this tab.</p></body></html>");
          finish({ error: "No authorization code received" });
          return;
        }

        log("MCP_OAUTH", `Received auth code for "${serverName}", exchanging for tokens...`);

        try {
          // Call auth() again with the authorization code — it handles the token exchange
          const result = await auth(activeProvider, {
            serverUrl,
            authorizationCode: code,
          });

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to PccAgent.</p></body></html>");

          const tokens = activeProvider.tokens();
          if (tokens?.access_token) {
            log("MCP_OAUTH", `OAuth tokens obtained for "${serverName}" (result=${result})`);
            finish({ accessToken: tokens.access_token });
          } else {
            log("MCP_OAUTH", `Token exchange completed but no access_token found (result=${result})`);
            finish({ error: "Token exchange succeeded but no access token was returned" });
          }
        } catch (err) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>");
          const msg = reportError("MCP_OAUTH", err, { context: "token-exchange", serverName });
          finish({ error: `Token exchange failed: ${msg}` });
        }
      } catch (err) {
        const msg = reportError("MCP_OAUTH", err, { context: "callback-handler", serverName });
        try {
          if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
          if (!res.writableEnded) res.end("Authentication callback failed");
        } catch {
          // The browser may have disconnected before the error response.
        }
        finish({ error: `OAuth callback failed: ${msg}` });
      }
    });

    callbackServer.on("error", (err) => {
      const msg = reportError("MCP_OAUTH", err, { context: "callback-server", serverName });
      finish({ error: `Could not start OAuth callback server: ${msg}` });
    });

    callbackServer.listen(0, OAUTH_LOOPBACK_HOST, async () => {
      const address = callbackServer?.address();
      if (!address || typeof address === "string") {
        finish({ error: "Could not determine OAuth callback port" });
        return;
      }

      port = address.port;
      provider = new ElectronOAuthClientProvider(serverName, serverUrl, port);
      const activeProvider = provider;

      log("MCP_OAUTH", `Starting OAuth flow for "${serverName}" at ${serverUrl} (callback port=${port})`);
      log("MCP_OAUTH", `Callback server listening on port ${port}`);

      try {
        // Start the OAuth flow — this discovers endpoints, registers client, and opens browser
        const result = await auth(activeProvider, { serverUrl });

        // If auth() returns "AUTHORIZED", tokens are already available (e.g. from cache/refresh)
        if (result === "AUTHORIZED") {
          const tokens = activeProvider.tokens();
          if (tokens?.access_token) {
            log("MCP_OAUTH", `Already authorized for "${serverName}" (had valid tokens)`);
            finish({ accessToken: tokens.access_token });
          }
        }
        // If "REDIRECT", the browser was opened and we wait for the callback
      } catch (err) {
        const msg = reportError("MCP_OAUTH", err, { context: "flow-initiation", serverName });
        finish({ error: `OAuth initiation failed: ${msg}` });
      }
    });
  });
}

export async function getMcpAuthHeaders(
  serverName: string,
  serverUrl: string,
): Promise<Record<string, string> | null> {
  const data = loadOAuthData(serverName);
  if (!data?.tokens?.access_token) return null;

  // Check if token might be expired
  if (data.tokens.expires_in) {
    const tokenAge = (Date.now() - data.storedAt) / 1000;
    if (tokenAge >= data.tokens.expires_in - 60) {
      // Token expired or about to expire
      if (data.tokens.refresh_token) {
        const refreshed = await refreshMcpToken(serverName, serverUrl);
        if (refreshed) {
          return { Authorization: `Bearer ${refreshed}` };
        }
      }
      // No refresh token or refresh failed — token is expired, need re-auth
      return null;
    }
  }

  return { Authorization: `Bearer ${data.tokens.access_token}` };
}

async function refreshMcpToken(
  serverName: string,
  serverUrl: string,
): Promise<string | null> {
  try {
    const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");

    // Use port 0 — we won't need the callback for refresh
    const provider = new ElectronOAuthClientProvider(serverName, serverUrl, 0);

    const result = await auth(provider, { serverUrl });

    if (result === "AUTHORIZED") {
      const tokens = provider.tokens();
      if (tokens?.access_token) {
        log("MCP_OAUTH", `Token refreshed for "${serverName}"`);
        return tokens.access_token;
      }
    }

    log("MCP_OAUTH", `Token refresh for "${serverName}" returned ${result}, needs re-auth`);
    return null;
  } catch (err) {
    reportError("MCP_OAUTH", err, { context: "token-refresh", serverName });
    return null;
  }
}
