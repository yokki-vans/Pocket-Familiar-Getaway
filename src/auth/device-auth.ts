import type { Device } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifySecret } from "./token.js";

export type AuthenticatedDevice = Device;

export async function requireDevice(request: FastifyRequest, reply: FastifyReply) {
  const deviceId = request.headers["x-device-id"];
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (typeof deviceId !== "string" || !token) {
    return reply.code(401).send({ error: { code: "DEVICE_UNAUTHORIZED", message: "Device unauthorized" } });
  }
  const device = await request.server.prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.status !== "active" || !verifySecret(token, device.tokenHash)) {
    return reply.code(device?.status === "revoked" ? 403 : 401).send({
      error: { code: "DEVICE_UNAUTHORIZED", message: "Device unauthorized" }
    });
  }
  await request.server.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  request.device = device;
}

export async function authenticateDeviceCredentials(server: FastifyRequest["server"], deviceId?: string, token?: string) {
  if (!deviceId || !token) return null;
  const device = await server.prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.status !== "active" || !verifySecret(token, device.tokenHash)) return null;
  await server.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return device;
}

declare module "fastify" {
  interface FastifyRequest {
    device?: AuthenticatedDevice;
  }
}
