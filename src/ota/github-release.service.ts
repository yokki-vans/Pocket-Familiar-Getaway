import fetch, { type Response } from "node-fetch";
import { z } from "zod";
import { config } from "../config.js";

const releaseAssetSchema = z.object({
  id: z.number(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  content_type: z.string().optional(),
  browser_download_url: z.string().url().optional()
});

const releaseSchema = z.object({
  id: z.number(),
  tag_name: z.string(),
  name: z.string().nullable().optional(),
  html_url: z.string().url(),
  published_at: z.string().nullable().optional(),
  assets: z.array(releaseAssetSchema)
});

const otaManifestSchema = z.object({
  version: z.string().min(1),
  hardware: z.string().min(1),
  release_tag: z.string().min(1),
  firmware_asset: z.string().min(1),
  firmware_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  firmware_size: z.number().int().positive(),
  build_time: z.string().optional(),
  git_sha: z.string().optional()
});

export type OtaManifest = z.infer<typeof otaManifestSchema>;
type Release = z.infer<typeof releaseSchema>;
type ReleaseAsset = z.infer<typeof releaseAssetSchema>;

export class OtaNotConfiguredError extends Error {}
export class OtaUnavailableError extends Error {}

let cached:
  | {
      expiresAt: number;
      release: Release;
      manifest: OtaManifest;
      firmwareAsset: ReleaseAsset;
    }
  | undefined;

function githubHeaders(accept = "application/vnd.github+json") {
  const headers: Record<string, string> = {
    accept,
    "user-agent": "pocket-gateway-ota"
  };
  if (config.OTA_GITHUB_TOKEN) headers.authorization = `Bearer ${config.OTA_GITHUB_TOKEN}`;
  return headers;
}

function assertOtaConfigured() {
  if (!config.OTA_ENABLED) throw new OtaNotConfiguredError("OTA is disabled");
  if (!config.OTA_GITHUB_REPO.includes("/")) throw new OtaNotConfiguredError("OTA_GITHUB_REPO must be owner/repo");
}

async function githubGet(url: string, accept?: string) {
  const response = await fetch(url, {
    headers: githubHeaders(accept),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new OtaUnavailableError(`GitHub request failed: ${response.status}`);
  return response;
}

async function fetchLatestRelease() {
  const response = await githubGet(`https://api.github.com/repos/${config.OTA_GITHUB_REPO}/releases/latest`);
  return releaseSchema.parse(await response.json());
}

async function fetchReleaseAssetJson(asset: ReleaseAsset) {
  const response = await githubGet(
    `https://api.github.com/repos/${config.OTA_GITHUB_REPO}/releases/assets/${asset.id}`,
    "application/octet-stream"
  );
  return response.json();
}

export async function getLatestOtaRelease() {
  assertOtaConfigured();
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached;

  const release = await fetchLatestRelease();
  const manifestAsset = release.assets.find((asset) => asset.name === config.OTA_MANIFEST_ASSET);
  if (!manifestAsset) throw new OtaUnavailableError(`Release asset ${config.OTA_MANIFEST_ASSET} not found`);

  const manifest = otaManifestSchema.parse(await fetchReleaseAssetJson(manifestAsset));
  const firmwareAsset = release.assets.find((asset) => asset.name === manifest.firmware_asset || asset.name === config.OTA_FIRMWARE_ASSET);
  if (!firmwareAsset) throw new OtaUnavailableError(`Firmware asset ${manifest.firmware_asset} not found`);

  if (firmwareAsset.size !== manifest.firmware_size) {
    throw new OtaUnavailableError("Firmware asset size does not match manifest");
  }

  cached = {
    expiresAt: now + config.OTA_CACHE_TTL_SECONDS * 1000,
    release,
    manifest,
    firmwareAsset
  };
  return cached;
}

export async function downloadLatestFirmware(): Promise<{ response: Response; manifest: OtaManifest; asset: ReleaseAsset }> {
  const latest = await getLatestOtaRelease();
  const response = await githubGet(
    `https://api.github.com/repos/${config.OTA_GITHUB_REPO}/releases/assets/${latest.firmwareAsset.id}`,
    "application/octet-stream"
  );
  return { response, manifest: latest.manifest, asset: latest.firmwareAsset };
}
