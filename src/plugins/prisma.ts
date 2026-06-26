import fp from "fastify-plugin";
import { prisma } from "../db/prisma.js";

export const prismaPlugin = fp(async (app) => {
  app.decorate("prisma", prisma);
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}
