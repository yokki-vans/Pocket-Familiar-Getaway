import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireDevice } from "../auth/device-auth.js";
import { createDeviceToken, hashSecret, verifySecret } from "../auth/token.js";
import { hashPairingCode, newDeviceId, newPairingCode, newPairingId, pairingExpiresAt } from "../auth/pairing.js";

const pairStartSchema = z.object({
  device_name: z.string().min(1).max(80),
  firmware_version: z.string().min(1).max(40),
  hardware: z.string().min(1).max(120),
  public_key: z.string().nullable().optional()
});

const pairCompleteSchema = z.object({
  pairing_id: z.string().min(1),
  pairing_code: z.string().regex(/^\d{6}$/)
});

const statusSchema = z.object({
  firmware_version: z.string().optional(),
  battery_percent: z.number().int().min(0).max(100).optional(),
  charging: z.boolean().optional(),
  wifi_rssi: z.number().int().optional(),
  free_heap: z.number().int().optional(),
  free_psram: z.number().int().optional(),
  sd_present: z.boolean().optional(),
  sd_free_mb: z.number().int().optional(),
  current_screen: z.string().max(40).optional(),
  uptime_sec: z.number().int().optional()
});

export async function deviceRoutes(app: FastifyInstance, prefix: string) {
  app.post(`${prefix}/device/pair/start`, { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = pairStartSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    const pairingCode = newPairingCode();
    const session = await app.prisma.pairingSession.create({
      data: {
        id: newPairingId(),
        pairingCodeHash: hashPairingCode(pairingCode),
        deviceName: parsed.data.device_name,
        hardware: parsed.data.hardware,
        firmwareVersion: parsed.data.firmware_version,
        publicKey: parsed.data.public_key ?? null,
        expiresAt: pairingExpiresAt()
      }
    });
    return { pairing_id: session.id, pairing_code: pairingCode, expires_in: config.PAIRING_CODE_TTL_SECONDS };
  });

  app.post(`${prefix}/device/pair/complete`, async (request, reply) => {
    const parsed = pairCompleteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    const session = await app.prisma.pairingSession.findUnique({ where: { id: parsed.data.pairing_id } });
    if (!session || !verifySecret(parsed.data.pairing_code, session.pairingCodeHash)) {
      return reply.code(404).send({ error: { code: "PAIRING_NOT_FOUND", message: "Pairing not found" } });
    }
    if (session.expiresAt < new Date()) {
      await app.prisma.pairingSession.update({ where: { id: session.id }, data: { status: "expired" } });
      return reply.code(410).send({ error: { code: "PAIRING_EXPIRED", message: "Pairing expired" } });
    }
    if (session.status !== "confirmed" || !session.deviceId) return { status: "pending" };
    const rawToken = createDeviceToken();
    await app.prisma.$transaction([
      app.prisma.device.update({ where: { id: session.deviceId }, data: { tokenHash: hashSecret(rawToken) } }),
      app.prisma.pairingSession.update({ where: { id: session.id }, data: { status: "consumed", consumedAt: new Date() } })
    ]);
    return {
      status: "confirmed",
      device_id: session.deviceId,
      device_token: rawToken,
      gateway_url: config.PUBLIC_GATEWAY_URL,
      active_agent: config.DEFAULT_AGENT
    };
  });

  app.get(`${prefix}/device/config`, { preHandler: requireDevice }, async (request) => ({
    device_id: request.device?.id,
    active_agent: request.device?.activeAgent,
    gateway: { url: config.PUBLIC_GATEWAY_URL, api_version: "v1" },
    features: { voice_notes: true, audio_command: true, transcription: true, ota: config.OTA_ENABLED },
    limits: { max_voice_note_mb: config.MAX_VOICE_NOTE_MB, max_audio_command_seconds: 60 }
  }));

  app.post(`${prefix}/device/status`, { preHandler: requireDevice, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success || !request.device) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    await app.prisma.deviceStatus.create({
      data: {
        deviceId: request.device.id,
        batteryPercent: parsed.data.battery_percent,
        charging: parsed.data.charging,
        wifiRssi: parsed.data.wifi_rssi,
        freeHeap: parsed.data.free_heap,
        freePsram: parsed.data.free_psram,
        sdPresent: parsed.data.sd_present,
        sdFreeMb: parsed.data.sd_free_mb,
        currentScreen: parsed.data.current_screen,
        uptimeSec: parsed.data.uptime_sec,
        rawJson: parsed.data
      }
    });
    if (parsed.data.firmware_version) {
      await app.prisma.device.update({ where: { id: request.device.id }, data: { firmwareVersion: parsed.data.firmware_version } });
    }
    return { ok: true, server_time: new Date().toISOString() };
  });

  void newDeviceId;
}
