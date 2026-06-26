CREATE TYPE "DeviceLifecycleStatus" AS ENUM ('active', 'revoked');
CREATE TYPE "PairingStatus" AS ENUM ('pending', 'confirmed', 'expired', 'consumed');
CREATE TYPE "VoiceNoteStatus" AS ENUM ('uploaded', 'processed', 'failed');
CREATE TYPE "TranscriptionStatus" AS ENUM ('not_transcribed', 'transcribing', 'transcribed', 'failed');
CREATE TYPE "AgentSendStatus" AS ENUM ('not_sent', 'sent', 'failed');

CREATE TABLE "Device" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "hardware" TEXT NOT NULL,
  "firmwareVersion" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "publicKey" TEXT,
  "activeAgent" TEXT NOT NULL DEFAULT 'hermes',
  "status" "DeviceLifecycleStatus" NOT NULL DEFAULT 'active',
  "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PairingSession" (
  "id" TEXT NOT NULL,
  "pairingCodeHash" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "hardware" TEXT NOT NULL,
  "firmwareVersion" TEXT NOT NULL,
  "publicKey" TEXT,
  "status" "PairingStatus" NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "deviceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PairingSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceStatus" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "batteryPercent" INTEGER,
  "charging" BOOLEAN,
  "wifiRssi" INTEGER,
  "freeHeap" INTEGER,
  "freePsram" INTEGER,
  "sdPresent" BOOLEAN,
  "sdFreeMb" INTEGER,
  "currentScreen" TEXT,
  "uptimeSec" INTEGER,
  "rawJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceStatus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoiceNote" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "localNoteId" TEXT NOT NULL,
  "title" TEXT,
  "filePath" TEXT NOT NULL,
  "originalFilename" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "sampleRate" INTEGER NOT NULL,
  "bitsPerSample" INTEGER NOT NULL,
  "channels" INTEGER NOT NULL,
  "status" "VoiceNoteStatus" NOT NULL DEFAULT 'uploaded',
  "transcriptionStatus" "TranscriptionStatus" NOT NULL DEFAULT 'not_transcribed',
  "transcript" TEXT,
  "agentSendStatus" "AgentSendStatus" NOT NULL DEFAULT 'not_sent',
  "activeAgent" TEXT NOT NULL DEFAULT 'hermes',
  "createdAtDevice" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VoiceNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentEvent" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "requestJson" JSONB NOT NULL,
  "responseJson" JSONB,
  "resultCardJson" JSONB,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceNote_deviceId_localNoteId_key" ON "VoiceNote"("deviceId", "localNoteId");
ALTER TABLE "DeviceStatus" ADD CONSTRAINT "DeviceStatus_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceNote" ADD CONSTRAINT "VoiceNote_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
