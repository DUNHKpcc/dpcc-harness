/** Shared gateway eligibility rules for settings writes and session resolution. */

const DPCC_HOST_RE = /dpccgaming\.xyz/i;

export interface GatewayRoutingInput {
  enabled: boolean;
  baseUrl: string;
  credential: string;
}

export function isDpccUpstreamUrl(baseUrl: string | undefined): boolean {
  const url = (baseUrl ?? "").trim();
  return url === "" || DPCC_HOST_RE.test(url);
}

export function resolveGatewayConfigSource({
  enabled,
  baseUrl,
  credential,
}: GatewayRoutingInput): "default" | "gateway" {
  return enabled && baseUrl.trim() !== "" && credential.trim() !== "" && !isDpccUpstreamUrl(baseUrl)
    ? "gateway"
    : "default";
}

export function isActiveThirdPartyGateway(input: GatewayRoutingInput): boolean {
  return resolveGatewayConfigSource(input) === "gateway";
}
