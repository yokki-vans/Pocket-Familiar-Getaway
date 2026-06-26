import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireDevice } from "../auth/device-auth.js";
import { downloadLatestFirmware, getLatestOtaRelease, OtaNotConfiguredError } from "../ota/github-release.service.js";
import { isNewerVersion } from "../ota/version.js";

const otaCheckQuerySchema = z.object({
  current_version: z.string().min(1).max(40).optional(),
  hardware: z.string().min(1).max(120).optional()
});

const otaDownloadQuerySchema = z.object({
  version: z.string().min(1).max(40).optional()
});

export async function otaRoutes(app: FastifyInstance, prefix: string) {
  app.get(`${prefix}/device/ota/check`, { preHandler: requireDevice }, async (request, reply) => {
    if (!request.device) return reply.code(401).send({ error: { code: "DEVICE_UNAUTHORIZED", message: "Device unauthorized" } });

    const parsed = otaCheckQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });

    try {
      const latest = await getLatestOtaRelease();
      const currentVersion = parsed.data.current_version ?? request.device.firmwareVersion;
      const hardware = parsed.data.hardware ?? request.device.hardware;
      const hardwareMatches = latest.manifest.hardware === hardware;
      const updateAvailable = hardwareMatches && isNewerVersion(latest.manifest.version, currentVersion);
      const firmwareUrl = new URL(`${prefix}/device/ota/firmware`, config.PUBLIC_GATEWAY_URL);
      firmwareUrl.searchParams.set("version", latest.manifest.version);

      return {
        ota_enabled: true,
        update_available: updateAvailable,
        current_version: currentVersion,
        latest_version: latest.manifest.version,
        hardware,
        hardware_supported: hardwareMatches,
        firmware: updateAvailable
          ? {
              url: firmwareUrl.toString(),
              sha256: latest.manifest.firmware_sha256,
              size: latest.manifest.firmware_size,
              content_type: "application/octet-stream"
            }
          : null,
        release: {
          tag: latest.release.tag_name,
          url: latest.release.html_url,
          published_at: latest.release.published_at ?? null
        }
      };
    } catch (error) {
      if (error instanceof OtaNotConfiguredError) {
        return {
          ota_enabled: false,
          update_available: false,
          current_version: parsed.data.current_version ?? request.device.firmwareVersion,
          latest_version: null,
          reason: "disabled"
        };
      }
      request.log.error({ error }, "OTA check failed");
      if (error instanceof Error && "code" in error && error.code === "OTA_GITHUB_AUTH_REQUIRED") {
        return reply.code(503).send({
          error: {
            code: "OTA_GITHUB_AUTH_REQUIRED",
            message: "Gateway cannot access firmware GitHub releases. Set OTA_GITHUB_TOKEN in Railway."
          }
        });
      }
      return reply.code(503).send({ error: { code: "OTA_UNAVAILABLE", message: "OTA release is unavailable" } });
    }
  });

  app.get(`${prefix}/device/ota/firmware`, { preHandler: requireDevice }, async (request, reply) => {
    const parsed = otaDownloadQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });

    try {
      const { response, manifest, asset } = await downloadLatestFirmware();
      if (parsed.data.version && parsed.data.version !== manifest.version) {
        return reply.code(404).send({ error: { code: "OTA_VERSION_NOT_FOUND", message: "OTA version not found" } });
      }
      if (!response.body) return reply.code(503).send({ error: { code: "OTA_UNAVAILABLE", message: "OTA asset is unavailable" } });

      reply.header("content-type", "application/octet-stream");
      reply.header("content-length", String(asset.size));
      reply.header("x-ota-version", manifest.version);
      reply.header("x-ota-sha256", manifest.firmware_sha256);
      reply.header("cache-control", "private, max-age=60");
      return reply.send(response.body);
    } catch (error) {
      if (error instanceof OtaNotConfiguredError) {
        return reply.code(404).send({ error: { code: "OTA_DISABLED", message: "OTA is disabled" } });
      }
      request.log.error({ error }, "OTA firmware download failed");
      if (error instanceof Error && "code" in error && error.code === "OTA_GITHUB_AUTH_REQUIRED") {
        return reply.code(503).send({
          error: {
            code: "OTA_GITHUB_AUTH_REQUIRED",
            message: "Gateway cannot access firmware GitHub releases. Set OTA_GITHUB_TOKEN in Railway."
          }
        });
      }
      return reply.code(503).send({ error: { code: "OTA_UNAVAILABLE", message: "OTA asset is unavailable" } });
    }
  });
}
