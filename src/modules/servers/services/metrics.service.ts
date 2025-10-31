import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SshService } from '../../ssh/ssh.service';
import { ServerMetricsDto, InstanceMetricsDto } from '../dto/server-metrics.dto';
import * as crypto from 'crypto';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private prisma: PrismaService,
    private sshService: SshService,
  ) {}

  /**
   * Get performance metrics for a specific Minecraft server
   */
  async getServerMetrics(serverId: string): Promise<ServerMetricsDto> {
    const server = await this.prisma.minecraftServer.findUnique({
      where: { id: serverId },
      include: { instance: true },
    });

    if (!server) {
      throw new BadRequestException('Server not found');
    }

    const instance = server.instance;
    const credentials = {
      host: instance.ipAddress,
      port: instance.sshPort,
      username: instance.sshUser,
      password: instance.sshPassword
        ? this.decrypt(instance.sshPassword)
        : undefined,
      privateKey: instance.sshKey ? this.decrypt(instance.sshKey) : undefined,
    };

    try {
      // Get Java process ID for this specific server
      const pidCommand = `pgrep -f "${server.internalName}" | head -1`;
      const pidResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        pidCommand,
      );
      const pid = pidResult.stdout.trim();

      if (!pid) {
        // Server is not running
        return {
          cpuUsage: 0,
          memoryUsedMb: 0,
          memoryAllocatedMb: server.allocatedRamMb,
          memoryUsagePercent: 0,
          diskUsedGb: 0,
          diskTotalGb: 0,
          diskUsagePercent: 0,
          uptimeSeconds: 0,
          activePlayers: 0,
          maxPlayers: server.maxPlayers,
        };
      }

      // Get CPU and memory usage for this process
      const statsCommand = `ps -p ${pid} -o %cpu,%mem,etime --no-headers`;
      const statsResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        statsCommand,
      );

      const [cpuUsage, memPercent, uptime] = statsResult.stdout.trim().split(/\s+/);

      // Calculate memory in MB
      const memoryUsedMb = Math.round(
        (parseFloat(memPercent) / 100) * (instance.totalRamMb || 16384),
      );

      // Get disk usage for server directory
      const diskCommand = `du -sm "${server.serverPath}" | awk '{print $1}' && df -BG "${server.serverPath}" | tail -1 | awk '{print $2, $4}'`;
      const diskResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        diskCommand,
      );
      const diskLines = diskResult.stdout.trim().split('\n');
      const diskUsedMb = parseInt(diskLines[0]);
      const [diskTotal, diskAvail] = diskLines[1].split(' ').map((s) => parseInt(s.replace('G', '')));

      // Parse uptime (format: [[dd-]hh:]mm:ss)
      const uptimeSeconds = this.parseUptime(uptime);

      // Get player count from RCON if server is running
      let activePlayers = 0;
      try {
        const players = await this.getPlayerCount(serverId);
        activePlayers = players;
      } catch (error) {
        // Ignore RCON errors
      }

      return {
        cpuUsage: parseFloat(cpuUsage),
        memoryUsedMb,
        memoryAllocatedMb: server.allocatedRamMb,
        memoryUsagePercent: Math.round(
          (memoryUsedMb / server.allocatedRamMb) * 100,
        ),
        diskUsedGb: diskUsedMb / 1024,
        diskTotalGb: diskTotal,
        diskUsagePercent: Math.round(((diskTotal - diskAvail) / diskTotal) * 100),
        uptimeSeconds,
        activePlayers,
        maxPlayers: server.maxPlayers,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get metrics for server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to retrieve server metrics');
    }
  }

  /**
   * Get overall instance performance metrics
   */
  async getInstanceMetrics(instanceId: string): Promise<InstanceMetricsDto> {
    const instance = await this.prisma.remoteInstance.findUnique({
      where: { id: instanceId },
      include: {
        servers: {
          where: { status: 'RUNNING' },
        },
      },
    });

    if (!instance) {
      throw new BadRequestException('Instance not found');
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

    try {
      // Get CPU usage (1-minute average)
      const cpuCommand = `top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//'`;
      const cpuResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        cpuCommand,
      );
      const cpuUsage = parseFloat(cpuResult.stdout.trim()) || 0;

      // Get memory info
      const memCommand = `free -m | grep Mem | awk '{print $3, $2}'`;
      const memResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        memCommand,
      );
      const [memUsed, memTotal] = memResult.stdout.trim().split(' ').map(Number);

      // Get disk info
      const diskCommand = `df -BG / | tail -1 | awk '{print $3, $2, $5}'`;
      const diskResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        diskCommand,
      );
      const [diskUsed, diskTotal, diskPercent] = diskResult.stdout.trim().split(' ');

      // Get system uptime
      const uptimeCommand = `cat /proc/uptime | awk '{print $1}'`;
      const uptimeResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        uptimeCommand,
      );
      const uptimeSeconds = Math.floor(parseFloat(uptimeResult.stdout.trim()));

      // Get load averages
      const loadCommand = `cat /proc/loadavg | awk '{print $1, $2, $3}'`;
      const loadResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        loadCommand,
      );
      const [load1m, load5m, load15m] = loadResult.stdout.trim().split(' ').map(Number);

      return {
        cpuUsage,
        memoryUsedMb: memUsed,
        memoryTotalMb: memTotal,
        memoryUsagePercent: Math.round((memUsed / memTotal) * 100),
        diskUsedGb: parseFloat(diskUsed.replace('G', '')),
        diskTotalGb: parseFloat(diskTotal.replace('G', '')),
        diskUsagePercent: parseFloat(diskPercent.replace('%', '')),
        runningServers: instance.servers.length,
        uptimeSeconds,
        loadAverage1m: load1m,
        loadAverage5m: load5m,
        loadAverage15m: load15m,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get metrics for instance ${instanceId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to retrieve instance metrics');
    }
  }

  /**
   * Parse uptime string to seconds
   */
  private parseUptime(uptime: string): number {
    try {
      const parts = uptime.split(/[-:]/);
      let seconds = 0;

      if (parts.length === 4) {
        // Format: dd-hh:mm:ss
        seconds =
          parseInt(parts[0]) * 86400 +
          parseInt(parts[1]) * 3600 +
          parseInt(parts[2]) * 60 +
          parseInt(parts[3]);
      } else if (parts.length === 3) {
        // Format: hh:mm:ss
        seconds =
          parseInt(parts[0]) * 3600 +
          parseInt(parts[1]) * 60 +
          parseInt(parts[2]);
      } else if (parts.length === 2) {
        // Format: mm:ss
        seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      }

      return seconds;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get player count from database
   */
  private async getPlayerCount(serverId: string): Promise<number> {
    const server = await this.prisma.minecraftServer.findUnique({
      where: { id: serverId },
      select: { currentPlayers: true },
    });

    return server?.currentPlayers || 0;
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
