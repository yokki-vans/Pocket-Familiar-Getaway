import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== config.ADMIN_API_KEY) {
    return reply.code(401).send({ error: { code: "ADMIN_UNAUTHORIZED", message: "Admin unauthorized" } });
  }
}
