import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireAdmin } from "../auth/admin-auth.js";
import { hashSecret } from "../auth/token.js";
import { hashPairingCode, newDeviceId } from "../auth/pairing.js";

const confirmSchema = z.object({
  pairing_code: z.string().regex(/^\d{6}$/),
  owner_label: z.string().min(1).max(80)
});

export async function adminRoutes(app: FastifyInstance, prefix: string) {
  app.post(`${prefix}/admin/pair/confirm`, { preHandler: requireAdmin, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    const sessions = await app.prisma.pairingSession.findMany({ where: { status: "pending", expiresAt: { gt: new Date() } } });
    const session = sessions.find((candidate) => candidate.pairingCodeHash === hashPairingCode(parsed.data.pairing_code));
    if (!session) return reply.code(404).send({ error: { code: "PAIRING_NOT_FOUND", message: "Pairing not found" } });
    const deviceId = newDeviceId();
    await app.prisma.$transaction([
      app.prisma.device.create({
        data: {
          id: deviceId,
          name: parsed.data.owner_label,
          hardware: session.hardware,
          firmwareVersion: session.firmwareVersion,
          publicKey: session.publicKey,
          activeAgent: config.DEFAULT_AGENT,
          tokenHash: hashSecret(`pending:${deviceId}`)
        }
      }),
      app.prisma.pairingSession.update({
        where: { id: session.id },
        data: { status: "confirmed", confirmedAt: new Date(), deviceId }
      })
    ]);
    return { ok: true, device_id: deviceId };
  });
}
