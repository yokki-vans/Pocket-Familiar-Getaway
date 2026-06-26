import { mkdir } from "node:fs/promises";
import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();
await mkdir(config.UPLOAD_DIR, { recursive: true });

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
