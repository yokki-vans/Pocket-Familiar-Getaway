import websocket from "@fastify/websocket";
import fp from "fastify-plugin";

export const websocketPlugin = fp(async (app) => {
  await app.register(websocket);
});
