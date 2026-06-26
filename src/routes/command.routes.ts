import { nanoid } from "nanoid";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAgent } from "../agents/agent-registry.js";
import { requireDevice } from "../auth/device-auth.js";

const commandSchema = z.object({
  text: z.string().min(1).max(2000),
  agent_id: z.string().optional(),
  context: z.record(z.unknown()).optional()
});

export async function commandRoutes(app: FastifyInstance, prefix: string) {
  app.post(`${prefix}/command/text`, { preHandler: requireDevice, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success || !request.device) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    const agent = getAgent(parsed.data.agent_id ?? request.device.activeAgent);
    const result = await agent.sendTextCommand({
      text: parsed.data.text,
      deviceId: request.device.id,
      sessionId: `sess_${nanoid(16)}`,
      context: parsed.data.context
    });
    await app.prisma.agentEvent.create({
      data: {
        deviceId: request.device.id,
        agentId: agent.id,
        type: "text_command",
        requestJson: JSON.parse(JSON.stringify(parsed.data)),
        resultCardJson: result as never,
        status: result.kind === "error" ? "failed" : "sent"
      }
    });
    return { result };
  });
}
