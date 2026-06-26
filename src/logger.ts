import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "*.authkey", "*.apiKey", "*.token", "*.device_token"],
    censor: "[redacted]"
  }
});
