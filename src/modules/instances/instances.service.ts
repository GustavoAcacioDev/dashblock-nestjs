import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { UpdateInstanceDto } from './dto/update-instance.dto';
import { InstanceResponseDto } from './dto/instance-response.dto';
import { InstanceStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class InstancesService {
  private readonly logger = new Logger(InstancesService.name);
  private readonly ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';

  constructor(
    private prisma: PrismaService,
    private sshService: SshService,
  ) {}

  /**
   * Create a new remote instance and test connection
   */
  async create(userId: string, dto: CreateInstanceDto): Promise<InstanceResponseDto> {
    // Check if user already has an instance
    const existing = await this.prisma.remoteInstance.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException('User already has a remote instance. Delete the existing one first.');
    }

    // Validate that either SSH key or password is provided
    if (!dto.sshKey && !dto.sshPassword) {
      throw new BadRequestException('Either sshKey or sshPassword must be provided');
    }

    let encryptedSshKey: string | null = null;
    let encryptedPassword: string | null = null;

    // Encrypt SSH key if provided
    if (dto.sshKey) {
      // Decode if base64, otherwise use as-is
      let keyContent = dto.sshKey;
      if (!dto.sshKey.includes('BEGIN')) {
        try {
          keyContent = Buffer.from(dto.sshKey, 'base64').toString('utf-8');
        } catch {
          // Not base64, use as-is
        }
      }
      encryptedSshKey = this.encrypt(keyContent);
    }

    // Encrypt password if provided
    if (dto.sshPassword) {
      encryptedPassword = this.encrypt(dto.sshPassword);
    }

    // Create instance record with PENDING status
    const instance = await this.prisma.remoteInstance.create({
      data: {
        userId,
        name: dto.name,
        ipAddress: dto.ipAddress,
        sshPort: dto.sshPort || 22,
        sshUser: dto.sshUser,
        sshKey: encryptedSshKey,
        sshPassword: encryptedPassword,
        status: InstanceStatus.PENDING,
      },
    });

    // Test connection in background and update status
    this.testAndUpdateInstance(instance.id, {
      host: dto.ipAddress,
      port: dto.sshPort || 22,
      username: dto.sshUser,
      privateKey: dto.sshKey || undefined,
      password: dto.sshPassword,
    });

    return new InstanceResponseDto(instance);
  }

  /**
   * Get user's instance
   */
  async findByUserId(userId: string): Promise<InstanceResponseDto | null> {
    const instance = await this.prisma.remoteInstance.findUnique({
      where: { userId },
    });

    if (!instance) {
      return null;
    }

    return new InstanceResponseDto(instance);
  }

  /**
   * Update instance
   */
  async update(userId: string, dto: UpdateInstanceDto): Promise<InstanceResponseDto> {
    const instance = await this.prisma.remoteInstance.findUnique({
      where: { userId },
    });

    if (!instance) {
      throw new NotFoundException('Instance not found');
    }

    let encryptedSshKey = instance.sshKey;
    let encryptedPassword = instance.sshPassword;

    // Update SSH key if provided
    if (dto.sshKey) {
      // Decode if base64, otherwise use as-is
      let keyContent = dto.sshKey;
      if (!dto.sshKey.includes('BEGIN')) {
        try {
          keyContent = Buffer.from(dto.sshKey, 'base64').toString('utf-8');
        } catch {
          // Not base64, use as-is
        }
      }
      encryptedSshKey = this.encrypt(keyContent);
    }

    // Update password if provided
    if (dto.sshPassword) {
      encryptedPassword = this.encrypt(dto.sshPassword);
    }

    const updated = await this.prisma.remoteInstance.update({
      where: { userId },
      data: {
        name: dto.name ?? instance.name,
        ipAddress: dto.ipAddress ?? instance.ipAddress,
        sshPort: dto.sshPort ?? instance.sshPort,
        sshUser: dto.sshUser ?? instance.sshUser,
        sshKey: encryptedSshKey,
        sshPassword: encryptedPassword,
        status: InstanceStatus.PENDING, // Re-test connection
      },
    });

    // Re-test connection with new credentials
    const plainSshKey = dto.sshKey || (instance.sshKey ? this.decrypt(instance.sshKey) : undefined);
    const plainPassword = dto.sshPassword || (instance.sshPassword ? this.decrypt(instance.sshPassword) : undefined);

    this.testAndUpdateInstance(updated.id, {
      host: updated.ipAddress,
      port: updated.sshPort,
      username: updated.sshUser,
      privateKey: plainSshKey,
      password: plainPassword,
    });

    return new InstanceResponseDto(updated);
  }

  /**
   * Delete instance
   */
  async remove(userId: string): Promise<void> {
    const instance = await this.prisma.remoteInstance.findUnique({
      where: { userId },
      include: { servers: true },
    });

    if (!instance) {
      throw new NotFoundException('Instance not found');
    }

    // Check if instance has servers
    if (instance.servers.length > 0) {
      throw new ConflictException(
        `Cannot delete instance with ${instance.servers.length} server(s). Delete all servers first.`,
      );
    }

    // Close SSH connection
    this.sshService.closeConnection(instance.id);

    // Delete instance
    await this.prisma.remoteInstance.delete({
      where: { userId },
    });

    this.logger.log(`Instance ${instance.id} deleted for user ${userId}`);
  }

  /**
   * Test connection and update instance status
   */
  async recheckConnection(userId: string): Promise<InstanceResponseDto> {
    const instance = await this.prisma.remoteInstance.findUnique({
      where: { userId },
    });

    if (!instance) {
      throw new NotFoundException('Instance not found');
    }

    await this.testAndUpdateInstance(instance.id, {
      host: instance.ipAddress,
      port: instance.sshPort,
      username: instance.sshUser,
      privateKey: instance.sshKey ? this.decrypt(instance.sshKey) : undefined,
      password: instance.sshPassword ? this.decrypt(instance.sshPassword) : undefined,
    });

    const updated = await this.prisma.remoteInstance.findUnique({
      where: { userId },
    });

    return new InstanceResponseDto(updated);
  }

  /**
   * Test connection and update instance with system info
   */
  private async testAndUpdateInstance(
    instanceId: string,
    credentials: {
      host: string;
      port: number;
      username: string;
      privateKey?: string;
      password?: string;
    },
  ): Promise<void> {
    try {
      // Test connection
      const canConnect = await this.sshService.testConnection(credentials);

      if (!canConnect) {
        await this.prisma.remoteInstance.update({
          where: { id: instanceId },
          data: {
            status: InstanceStatus.ERROR,
            lastErrorMsg: 'Failed to establish SSH connection',
            lastCheckAt: new Date(),
          },
        });
        return;
      }

      // Get system information
      const systemInfo = await this.sshService.getSystemInfo(instanceId, credentials);

      // Update instance with CONNECTED status and system info
      await this.prisma.remoteInstance.update({
        where: { id: instanceId },
        data: {
          status: InstanceStatus.CONNECTED,
          totalRamMb: systemInfo.totalRamMb,
          totalCpuCores: systemInfo.totalCpuCores,
          diskSpaceGb: systemInfo.diskSpaceGb,
          osType: systemInfo.osType,
          lastCheckAt: new Date(),
          lastErrorMsg: null,
        },
      });

      this.logger.log(`Instance ${instanceId} connected successfully`);
    } catch (error) {
      this.logger.error(`Failed to test instance ${instanceId}: ${error.message}`);
      await this.prisma.remoteInstance.update({
        where: { id: instanceId },
        data: {
          status: InstanceStatus.ERROR,
          lastErrorMsg: error.message,
          lastCheckAt: new Date(),
        },
      });
    }
  }

  /**
   * Encrypt sensitive data
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(this.ENCRYPTION_KEY, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  private decrypt(text: string): string {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift() || '', 'hex');
    const encryptedText = parts.join(':');
    const key = crypto.scryptSync(this.ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
