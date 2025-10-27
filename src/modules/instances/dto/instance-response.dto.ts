import { InstanceStatus } from '@prisma/client';

export class InstanceResponseDto {
  id: string;
  userId: string;
  name: string;
  ipAddress: string;
  sshPort: number;
  sshUser: string;
  status: InstanceStatus;
  totalRamMb?: number | null;
  totalCpuCores?: number | null;
  diskSpaceGb?: number | null;
  osType?: string | null;
  lastCheckAt?: Date | null;
  lastErrorMsg?: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Exclude sensitive fields (sshKeyPath, sshPassword)
  constructor(data: any) {
    this.id = data.id;
    this.userId = data.userId;
    this.name = data.name;
    this.ipAddress = data.ipAddress;
    this.sshPort = data.sshPort;
    this.sshUser = data.sshUser;
    this.status = data.status;
    this.totalRamMb = data.totalRamMb;
    this.totalCpuCores = data.totalCpuCores;
    this.diskSpaceGb = data.diskSpaceGb;
    this.osType = data.osType;
    this.lastCheckAt = data.lastCheckAt;
    this.lastErrorMsg = data.lastErrorMsg;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }
}
