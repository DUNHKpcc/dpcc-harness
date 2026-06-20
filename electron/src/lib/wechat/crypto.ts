import { randomBytes } from "node:crypto";

/**
 * Generate the `X-WECHAT-UIN` header value expected by the iLink Bot API:
 * base64(String(random_uint32)).
 */
export function generateWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}
