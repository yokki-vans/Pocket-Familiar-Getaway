# Pocket Gateway

Production-oriented Fastify gateway for Pocket Familiar ESP32-S3 devices. The device talks only to this gateway over HTTPS/WSS; Hermes and other agent secrets stay server-side.

## Features

- Device pairing with six-digit admin confirmation codes.
- Device bearer auth using `X-Device-Id` and `Authorization: Bearer <device_token>`.
- Revoked-device blocking, Zod validation, rate limits, structured logs, and short ESP32-friendly errors.
- Device config/status, agent listing, active-agent selection, text commands, WAV voice-note upload/list/detail/transcribe/send.
- Result card normalization for a 1.8 inch display.
- WebSocket `/api/v1/audio/command` protocol stub for live audio commands.
- Prisma PostgreSQL schema and initial migration.
- Railway-ready Docker deployment with userspace Tailscale support.

## Local Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

The app listens on `PORT` and exposes:

- `GET /health`
- `GET /api/v1/health`
- `/api/v1/*`
- `/v1/*` aliases

## Pairing Flow

1. ESP32 starts pairing: `POST /api/v1/device/pair/start`.
2. Admin confirms: `POST /api/v1/admin/pair/confirm` with `Authorization: Bearer $ADMIN_API_KEY`.
3. ESP32 polls: `POST /api/v1/device/pair/complete`.

Only the token hash is stored. The raw `device_token` is returned once from `pair/complete`.

## Railway

Set Railway variables:

```text
DATABASE_URL=<Railway PostgreSQL URL>
PUBLIC_GATEWAY_URL=https://<your-app>.up.railway.app
ADMIN_API_KEY=<long random value>
DEVICE_TOKEN_PEPPER=<long random value>
HERMES_BASE_URL=http://hermes-gateway:8080
HERMES_API_KEY=<Hermes API key>
TAILSCALE_ENABLED=true
TAILSCALE_AUTHKEY=<Tailscale auth key>
TAILSCALE_HOSTNAME=pocket-gateway-railway
TAILSCALE_STATE_DIR=/var/lib/tailscale
TAILSCALE_EXTRA_ARGS=--accept-dns=true
TAILSCALE_SOCKS5_ADDR=localhost:1055
```

Railway provides `PORT` automatically. Run migrations with `npm run prisma:migrate`.

## Tailscale

The Docker image installs `tailscaled` and starts it with:

```text
--tun=userspace-networking
--socks5-server=$TAILSCALE_SOCKS5_ADDR
```

This avoids privileged mode, `/dev/net/tun`, and host networking. The Hermes adapter uses `TAILSCALE_SOCKS5_ADDR` for outbound requests when it is set. If Tailscale is unavailable, the app still starts and health reports Hermes/Tailscale as offline.

Create a tagged reusable or ephemeral auth key in Tailscale admin. Recommended tag: `tag:pocket-gateway`. Put Hermes Gateway behind `tag:hermes-gateway`.

Recommended ACL:

```json
{
  "tagOwners": {
    "tag:pocket-gateway": ["autogroup:admin"],
    "tag:hermes-gateway": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:pocket-gateway"],
      "dst": ["tag:hermes-gateway:443", "tag:hermes-gateway:8080"]
    }
  ]
}
```

Do not allow Pocket Gateway to access the whole tailnet.

## Storage Notes

Voice notes are stored under `UPLOAD_DIR` for v1. Railway filesystem is ephemeral. This is acceptable for prototype use, but production should replace `LocalStorageProvider` with S3/R2 or another persistent object store. Persistent Tailscale state reduces re-auth events; ephemeral nodes and auth keys are cleaner for stateless redeploys.

## Security Notes

The ESP32 stores only `device_id`, `device_token`, `gateway_url`, `active_agent`, and pairing status. It never stores Hermes, OpenAI, Tailscale, Railway, or admin secrets.

Future keypair auth is reserved in `src/auth/signatures.future.ts` with the planned fields: `device_id`, `timestamp`, `nonce`, `body_hash`, and `signature`.
