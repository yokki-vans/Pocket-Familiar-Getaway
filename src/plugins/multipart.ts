import multipart from "@fastify/multipart";
import fp from "fastify-plugin";
import { config } from "../config.js";

export const multipartPlugin = fp(async (app) => {
  await app.register(multipart, {
    limits: {
      fileSize: config.maxVoiceNoteBytes,
      files: 1,
      fields: 4
    }
  });
});
