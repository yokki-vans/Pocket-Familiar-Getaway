import { randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { hashSecret } from "./token.js";

export function newPairingCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function newPairingId() {
  return `pair_${nanoid(24)}`;
}

export function newDeviceId() {
  return `dev_${nanoid(24)}`;
}

export function pairingExpiresAt() {
  return new Date(Date.now() + config.PAIRING_CODE_TTL_SECONDS * 1000);
}

export function hashPairingCode(code: string) {
  return hashSecret(code);
}
