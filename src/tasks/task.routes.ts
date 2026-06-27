import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateDeviceCredentials } from "../auth/device-auth.js";
import { requireDevice } from "../auth/device-auth.js";
import { getDeviceTask, listDeviceTasks, subscribeTasks } from "./task.service.js";

const idParams = z.object({ id: z.string().min(1) });

export async function taskRoutes(app: FastifyInstance, prefix: string) {
  app.get(`${prefix}/tasks`, { preHandler: requireDevice }, async (request) => {
    return { tasks: listDeviceTasks(request.device!.id) };
  });

  app.get(`${prefix}/tasks/:id`, { preHandler: requireDevice }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid task id" } });
    const task = getDeviceTask(request.device!.id, params.data.id);
    if (!task) return reply.code(404).send({ error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
    return { task };
  });

  app.get(`${prefix}/tasks/stream`, { websocket: true }, async (socket, request) => {
    const query = request.query as { device_id?: string; token?: string };
    const header = request.headers.authorization ?? "";
    const token = query.token ?? (header.startsWith("Bearer ") ? header.slice(7) : undefined);
    const device = await authenticateDeviceCredentials(app, query.device_id, token);
    if (!device) {
      socket.close(1008, "unauthorized");
      return;
    }
    for (const task of listDeviceTasks(device.id)) {
      socket.send(JSON.stringify({ type: "task.status", ...task }));
    }
    const unsubscribe = subscribeTasks((task) => {
      if (task.deviceId === device.id && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "task.status", ...task }));
      }
    });
    socket.on("close", unsubscribe);
  });
}
