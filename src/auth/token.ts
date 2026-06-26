import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function createDeviceToken() {
  return `pf_dev_token_${randomBytes(32).toString("base64url")}`;
}

export function hashSecret(secret: string) {
  return createHash("sha256").update(`${config.DEVICE_TOKEN_PEPPER}:${secret}`).digest("hex");
}

export function verifySecret(secret: string, hash: string) {
  const candidate = Buffer.from(hashSecret(secret), "hex");
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
