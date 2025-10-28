import { ServerStatus, ServerType } from '@prisma/client';

export class ServerResponseDto {
  id: string;
  userId: string;
  instanceId: string;
  name: string;
  internalName: string;
  description?: string | null;
  version: string;
  type: ServerType;
  gamePort: number;
  rconPort: number;
  allocatedRamMb: number;
  maxPlayers: number;
  serverPath: string;
  status: ServerStatus;
  currentPlayers?: number | null;
  createdAt: Date;
  updatedAt: Date;
  lastStartedAt?: Date | null;
  lastStoppedAt?: Date | null;

  constructor(server: any) {
    this.id = server.id;
    this.userId = server.userId;
    this.instanceId = server.instanceId;
    this.name = server.name;
    this.internalName = server.internalName;
    this.description = server.description;
    this.version = server.version;
    this.type = server.type;
    this.gamePort = server.gamePort;
    this.rconPort = server.rconPort;
    this.allocatedRamMb = server.allocatedRamMb;
    this.maxPlayers = server.maxPlayers;
    this.serverPath = server.serverPath;
    this.status = server.status;
    this.currentPlayers = server.currentPlayers;
    this.createdAt = server.createdAt;
    this.updatedAt = server.updatedAt;
    this.lastStartedAt = server.lastStartedAt;
    this.lastStoppedAt = server.lastStoppedAt;

    // Exclude sensitive data like rconPassword
  }
}
