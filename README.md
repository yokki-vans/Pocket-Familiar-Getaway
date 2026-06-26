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

## Railway Deployment

The recommended Railway setup is Dockerfile-based. The Dockerfile installs Tailscale, builds TypeScript into `dist/`, and starts `docker-entrypoint.sh`, which starts `tailscaled` before the Node app.

### 1. Create the Railway Project

1. Open Railway and choose **New Project**.
2. Select **Deploy from GitHub repo**.
3. Pick `yokki-vans/Pocket-Familiar-Getaway`.
4. In the service settings, make sure Railway uses the repository Dockerfile. This repo includes `railway.json` with `"builder": "DOCKERFILE"`.
5. Add a Railway PostgreSQL service to the same project.
6. Copy or reference PostgreSQL's `DATABASE_URL` into the gateway service variables.

Do not set a custom start command for the Dockerfile deployment. Let Railway run the Docker image entrypoint.

### 2. Railway Variables

Set these variables on the Pocket Gateway service:

```text
DATABASE_URL=<Railway PostgreSQL URL>
PUBLIC_GATEWAY_URL=https://<your-app>.up.railway.app
ADMIN_API_KEY=<long random value>
DEVICE_TOKEN_PEPPER=<long random value>
PAIRING_CODE_TTL_SECONDS=300
DEVICE_TOKEN_TTL_DAYS=3650
MAX_VOICE_NOTE_MB=50
UPLOAD_DIR=./uploads
DEFAULT_AGENT=hermes
HERMES_BASE_URL=http://hermes-gateway:8080
HERMES_API_KEY=<Hermes API key>
HERMES_TIMEOUT_MS=60000
STT_PROVIDER=mock
OPENAI_API_KEY=
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
TAILSCALE_ENABLED=true
TAILSCALE_AUTHKEY=<Tailscale auth key>
TAILSCALE_HOSTNAME=pocket-gateway-railway
TAILSCALE_STATE_DIR=/var/lib/tailscale
TAILSCALE_EXTRA_ARGS=--accept-dns=true
TAILSCALE_SOCKS5_ADDR=localhost:1055
LOG_LEVEL=info
```

Railway provides `PORT` automatically. Do not hardcode `PORT`.

`PUBLIC_GATEWAY_URL` should include `https://`. If it is blank, the app will try Railway's `RAILWAY_STATIC_URL` or `RAILWAY_PUBLIC_DOMAIN`; if you provide it manually, prefer the explicit public Railway URL.

### 3. Generate Secrets

Use long random values:

```bash
openssl rand -base64 32
```

Use separate values for `ADMIN_API_KEY` and `DEVICE_TOKEN_PEPPER`. Never put real keys in `.env.example`, README, firmware, or commits.

### 4. Tailscale Auth Key

In the Tailscale admin console:

1. Go to **Settings -> Keys**.
2. Create an auth key for the Railway gateway.
3. Recommended options:
   - Reusable if Railway redeploys often without persistent Tailscale state.
   - Ephemeral for stateless deployments where old nodes should disappear automatically.
   - Pre-approved if your tailnet requires device approval.
   - Tagged with `tag:pocket-gateway`.
4. Store the full key in Railway as `TAILSCALE_AUTHKEY`.

If `TAILSCALE_AUTHKEY` is missing, expired, truncated, or is not an auth key, Tailscale will log an error like:

```text
invalid key: API key ... not valid
```

The gateway will still start, but `/health` will report Tailscale and Hermes as offline.

### 5. Hermes URL Through Tailscale

Use one of these forms:

```text
HERMES_BASE_URL=http://hermes-gateway.tailnet-name.ts.net:8080
```

or:

```text
HERMES_BASE_URL=http://100.x.y.z:8080
```

Because Railway containers do not provide privileged TUN access, this gateway starts Tailscale in userspace mode and exposes a SOCKS5 proxy at `TAILSCALE_SOCKS5_ADDR`. Keep:

```text
TAILSCALE_SOCKS5_ADDR=localhost:1055
```

The Hermes adapter will route outbound Hermes HTTP requests through that SOCKS5 proxy.

### 6. Deploy

Push to `main`:

```bash
git push origin main
```

Railway should build with the Dockerfile, then start:

```text
./docker-entrypoint.sh
```

The entrypoint:

1. Creates `TAILSCALE_STATE_DIR`.
2. Starts `tailscaled --tun=userspace-networking`.
3. Starts the SOCKS5 proxy.
4. Runs `tailscale up` when `TAILSCALE_ENABLED=true`.
5. Starts `node dist/server.js`.

### 7. Run Database Migrations

Run migrations once after PostgreSQL is attached. You can do this from Railway with a one-off command:

```bash
npm run prisma:migrate
```

If you prefer migrations during deploy, set the service start command only for a native Node deployment, not for Dockerfile mode:

```bash
npm run prisma:migrate && npm run start
```

For Dockerfile mode, the image entrypoint is required for Tailscale. Run migrations as a Railway one-off command or from a CI step before deploy.

### 8. Verify Health

Open:

```text
https://<your-app>.up.railway.app/health
```

Expected with Tailscale and Hermes online:

```json
{
  "ok": true,
  "service": "pocket-gateway",
  "db": "ok",
  "tailscale": {
    "enabled": true,
    "status": "online",
    "hostname": "pocket-gateway-railway",
    "tailnet_ip": "100.x.y.z"
  },
  "agents": {
    "hermes": "online"
  }
}
```

If Hermes is not reachable yet, `ok` may be `false` and Hermes will show `offline`. The ESP32 can still pair and use gateway endpoints that do not require Hermes.

### 9. Pair the ESP32

Start pairing from the device:

```bash
curl -X POST https://<your-app>.up.railway.app/api/v1/device/pair/start \
  -H 'content-type: application/json' \
  -d '{
    "device_name": "Pocket Familiar",
    "firmware_version": "0.1.0",
    "hardware": "waveshare-esp32-s3-touch-amoled-1.8",
    "public_key": null
  }'
```

Confirm the six-digit code as admin:

```bash
curl -X POST https://<your-app>.up.railway.app/api/v1/admin/pair/confirm \
  -H "authorization: Bearer $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "pairing_code": "482913",
    "owner_label": "Eugene Pocket Familiar"
  }'
```

Complete pairing from the device:

```bash
curl -X POST https://<your-app>.up.railway.app/api/v1/device/pair/complete \
  -H 'content-type: application/json' \
  -d '{
    "pairing_id": "pair_xxx",
    "pairing_code": "482913"
  }'
```

Save the returned `device_id`, `device_token`, `gateway_url`, and `active_agent` on the ESP32. The raw `device_token` is returned only once.

### 10. Native Node/Nixpacks Alternative

If you intentionally disable Dockerfile mode, configure Railway build and start commands explicitly:

```bash
npm ci
npm run prisma:generate
npm run build
```

Start command:

```bash
npm run prisma:migrate && npm run start
```

Native mode does not install or start Tailscale from this repository. Use Dockerfile mode when Hermes must be reached through Tailscale.

### 11. Troubleshooting Railway Logs

`Error: Cannot find module '/app/dist/server.js'`

This means the TypeScript build did not produce the expected `dist/server.js`, the build did not run before the start command, or Railway was not using the Dockerfile image. Fix by using Dockerfile builder, redeploying the latest commit, or setting the native build command to run `npm run build`.

`Invalid configuration: PUBLIC_GATEWAY_URL: Invalid url`

Set `PUBLIC_GATEWAY_URL` to the full Railway URL, including `https://`, or leave it blank and let the app derive it from Railway's public-domain variables.

`invalid key: API key ... not valid`

This means `TAILSCALE_AUTHKEY` is not a valid Tailscale auth key. Create a fresh auth key in Tailscale admin and replace the Railway variable. Do not use a normal Tailscale API key.

`Tailscale is stopped` or `Tailscale is starting`

These messages can appear during container boot. Check `/health` after the app is fully started.

Hermes is `offline`

Check `HERMES_BASE_URL`, `HERMES_API_KEY`, Tailscale ACLs, and that the Hermes node is tagged and reachable on the configured port.

Railway filesystem is ephemeral

Uploaded WAV files under `UPLOAD_DIR` can disappear on redeploy. Use S3/R2 or another object store before relying on voice-note file persistence in production.

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
