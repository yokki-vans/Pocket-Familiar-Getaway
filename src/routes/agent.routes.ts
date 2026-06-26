import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAgents } from "../agents/agent-registry.js";
import { requireDevice } from "../auth/device-auth.js";

const activeSchema = z.object({ agent_id: z.enum(["hermes", "openclaw", "codex", "custom"]) });

export async function agentRoutes(app: FastifyInstance, prefix: string) {
  app.get(`${prefix}/agents`, { preHandler: requireDevice }, async (request) => {
    const agents = await Promise.all(listAgents().map(async (agent) => {
      const health = await agent.health();
      return { id: agent.id, name: agent.name, status: health.status, configured: health.configured };
    }));
    return { active_agent: request.device?.activeAgent, agents };
  });

  app.post(`${prefix}/agents/active`, { preHandler: requireDevice }, async (request, reply) => {
    const parsed = activeSchema.safeParse(request.body);
    if (!parsed.success || !request.device) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    await app.prisma.device.update({ where: { id: request.device.id }, data: { activeAgent: parsed.data.agent_id } });
    return { ok: true, active_agent: parsed.data.agent_id };
  });
}
