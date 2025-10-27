-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ServerType" AS ENUM ('VANILLA', 'FABRIC', 'FORGE', 'PAPER', 'SPIGOT', 'PURPUR');

-- CreateEnum
CREATE TYPE "ServerStatus" AS ENUM ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "planType" "PlanType" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remote_instances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUser" TEXT NOT NULL DEFAULT 'ubuntu',
    "sshKeyPath" TEXT,
    "sshPassword" TEXT,
    "totalRamMb" INTEGER,
    "totalCpuCores" INTEGER,
    "diskSpaceGb" INTEGER,
    "osType" TEXT,
    "status" "InstanceStatus" NOT NULL DEFAULT 'PENDING',
    "lastCheckAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remote_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "minecraft_servers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL,
    "type" "ServerType" NOT NULL DEFAULT 'VANILLA',
    "gamePort" INTEGER NOT NULL,
    "rconPort" INTEGER NOT NULL,
    "rconPassword" TEXT NOT NULL,
    "allocatedRamMb" INTEGER NOT NULL DEFAULT 1024,
    "maxPlayers" INTEGER NOT NULL DEFAULT 20,
    "serverPath" TEXT NOT NULL,
    "status" "ServerStatus" NOT NULL DEFAULT 'STOPPED',
    "currentPlayers" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastStoppedAt" TIMESTAMP(3),

    CONSTRAINT "minecraft_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "remote_instances_userId_key" ON "remote_instances"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "minecraft_servers_internalName_key" ON "minecraft_servers"("internalName");

-- CreateIndex
CREATE UNIQUE INDEX "minecraft_servers_gamePort_key" ON "minecraft_servers"("gamePort");

-- CreateIndex
CREATE UNIQUE INDEX "minecraft_servers_rconPort_key" ON "minecraft_servers"("rconPort");

-- CreateIndex
CREATE INDEX "minecraft_servers_userId_idx" ON "minecraft_servers"("userId");

-- CreateIndex
CREATE INDEX "minecraft_servers_instanceId_idx" ON "minecraft_servers"("instanceId");

-- CreateIndex
CREATE INDEX "minecraft_servers_status_idx" ON "minecraft_servers"("status");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_instances" ADD CONSTRAINT "remote_instances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minecraft_servers" ADD CONSTRAINT "minecraft_servers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minecraft_servers" ADD CONSTRAINT "minecraft_servers_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "remote_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
