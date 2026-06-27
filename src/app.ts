import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config.js";
import { loggerOptions } from "./logger.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { multipartPlugin } from "./plugins/multipart.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { healthRoutes } from "./routes/health.routes.js";
import { deviceRoutes } from "./routes/device.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { agentRoutes } from "./routes/agent.routes.js";
import { commandRoutes } from "./routes/command.routes.js";
import { voiceNotesRoutes } from "./routes/voice-notes.routes.js";
import { audioWsRoutes } from "./routes/audio-ws.routes.js";
import { assistantRoutes } from "./routes/assistant.routes.js";
import { voiceSessionRoutes } from "./routes/voice-session.routes.js";
import { taskRoutes } from "./tasks/task.routes.js";
import { otaRoutes } from "./routes/ota.routes.js";
import { adminUiRoutes } from "./routes/admin-ui.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    bodyLimit: config.maxVoiceNoteBytes,
    disableRequestLogging: false
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const message = status >= 500 && config.NODE_ENV === "production" ? "Internal error" : error.message;
    reply.code(status).send({ error: { code: status === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR", message } });
  });

  await app.register(cors, { origin: false });
  await app.register(prismaPlugin);
  await app.register(rateLimitPlugin);
  await app.register(multipartPlugin);
  await app.register(websocketPlugin);
  await app.register(healthRoutes);
  await app.register(adminUiRoutes);
  for (const prefix of ["/api/v1", "/v1"]) {
    await deviceRoutes(app, prefix);
    await adminRoutes(app, prefix);
    await agentRoutes(app, prefix);
    await commandRoutes(app, prefix);
    await voiceNotesRoutes(app, prefix);
    await assistantRoutes(app, prefix);
    await voiceSessionRoutes(app, prefix);
    await taskRoutes(app, prefix);
    await audioWsRoutes(app, prefix);
    await otaRoutes(app, prefix);
  }
  return app;
}
