import { config } from "./config.js";

export const loggerOptions = {
  level: config.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "*.authkey", "*.apiKey", "*.token", "*.device_token", "*.password"],
    censor: "[redacted]"
  }
};
