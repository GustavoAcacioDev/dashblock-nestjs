import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { SshService } from '../../ssh/ssh.service';
import { ServerStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class ServerMonitorService {
  private readonly logger = new Logger(ServerMonitorService.name);

  constructor(
    private prisma: PrismaService,
    private sshService: SshService,
  ) {}

  /**
   * Check all servers' status every 2 minutes
   * This runs automatically in the background
   */
  @Cron('0 */2 * * * *') // Every 2 minutes
  async monitorAllServers() {
    this.logger.log('Starting server status monitoring...');

    try {
      // Get all servers (including STOPPED ones to detect manual starts)
      const servers = await this.prisma.minecraftServer.findMany({
        where: {
          status: {
            not: ServerStatus.ERROR, // Only skip ERROR status servers
          },
        },
        include: {
          instance: true,
        },
      });

      this.logger.log(`Monitoring ${servers.length} servers`);

      // Check each server in parallel
      await Promise.allSettled(
        servers.map((server) => this.checkServerStatus(server)),
      );

      this.logger.log('Server monitoring completed');
    } catch (error) {
      this.logger.error(`Server monitoring failed: ${error.message}`);
    }
  }

  /**
   * Manually check a specific server's status (for on-demand checks)
   */
  async checkSpecificServer(serverId: string): Promise<void> {
    const server = await this.prisma.minecraftServer.findUnique({
      where: { id: serverId },
      include: { instance: true },
    });

    if (!server) {
      throw new Error('Server not found');
    }

    await this.checkServerStatus(server);
  }

  /**
   * Check individual server status
   */
  private async checkServerStatus(server: any): Promise<void> {
    try {
      const instance = server.instance;

      if (!instance || instance.status !== 'CONNECTED') {
        this.logger.warn(
          `Skipping server ${server.id} - instance not connected`,
        );
        return;
      }

      const credentials = {
        host: instance.ipAddress,
        port: instance.sshPort,
        username: instance.sshUser,
        password: instance.sshPassword
          ? this.decrypt(instance.sshPassword)
          : undefined,
        privateKey: instance.sshKey ? this.decrypt(instance.sshKey) : undefined,
      };

      // Check systemd service status
      const statusResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        `sudo systemctl is-active ${server.internalName}.service || echo "inactive"`,
      );

      const statusOutput = statusResult.stdout.trim();
      const isRunning = statusOutput === 'active';

      // Determine new status
      let newStatus: ServerStatus;
      if (isRunning) {
        // Server is running
        newStatus = ServerStatus.RUNNING;
      } else if (server.status === ServerStatus.STARTING) {
        // Still starting, don't change yet
        newStatus = ServerStatus.STARTING;
      } else if (server.status === ServerStatus.STOPPING) {
        // Stopped successfully
        newStatus = ServerStatus.STOPPED;
      } else {
        // Was running but now stopped, or already stopped
        newStatus = ServerStatus.STOPPED;
      }

      // Update status if changed
      if (server.status !== newStatus) {
        const updateData: any = {
          status: newStatus,
        };

        // If transitioning to RUNNING, update lastStartedAt
        if (newStatus === ServerStatus.RUNNING && server.status === ServerStatus.STOPPED) {
          updateData.lastStartedAt = new Date();
          this.logger.log(
            `Detected manually started server: ${server.name} (${server.id})`,
          );
        }

        // If transitioning to STOPPED, update lastStoppedAt
        if (newStatus === ServerStatus.STOPPED && server.status !== ServerStatus.STOPPED) {
          updateData.lastStoppedAt = new Date();
          updateData.currentPlayers = null;
        }

        await this.prisma.minecraftServer.update({
          where: { id: server.id },
          data: updateData,
        });

        this.logger.log(
          `Server ${server.name} (${server.id}) status changed: ${server.status} -> ${newStatus}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to check server ${server.id} status: ${error.message}`,
      );
    }
  }

  private decrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const encryptionKey =
      process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
    const key = crypto.scryptSync(encryptionKey, 'salt', 32);
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift() || '', 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
