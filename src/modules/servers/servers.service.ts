import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { PlanLimitsService } from './services/plan-limits.service';
import { PortAllocationService } from './services/port-allocation.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { ServerResponseDto } from './dto/server-response.dto';
import { ServerStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    private prisma: PrismaService,
    private sshService: SshService,
    private planLimitsService: PlanLimitsService,
    private portAllocationService: PortAllocationService,
  ) {}

  /**
   * Create a new Minecraft server
   */
  async create(
    userId: string,
    dto: CreateServerDto,
  ): Promise<ServerResponseDto> {
    // Check plan limits
    await this.planLimitsService.enforceCreateServerLimit(userId);

    // Get user's instance
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { instance: true },
    });

    if (!user?.instance) {
      throw new BadRequestException(
        'You must add a remote instance before creating servers',
      );
    }

    const instance = user.instance;

    if (instance.status !== 'CONNECTED') {
      throw new BadRequestException(
        'Your remote instance is not connected. Please check the connection first.',
      );
    }

    // Allocate ports
    const { gamePort, rconPort } =
      await this.portAllocationService.allocatePorts(instance.id);

    if (!gamePort || !rconPort) {
      throw new ConflictException(
        'Could not allocate ports. Maximum server capacity reached on this instance.',
      );
    }

    // Generate internal name (systemd service name)
    const internalName = this.generateInternalName(dto.name);

    // Generate RCON password
    const rconPassword = this.generateRconPassword();

    // Create server path
    const serverPath = `/home/${instance.sshUser}/minecraft/${internalName}`;

    // Create server in database
    const server = await this.prisma.minecraftServer.create({
      data: {
        userId,
        instanceId: instance.id,
        name: dto.name,
        internalName,
        description: dto.description,
        version: dto.version,
        type: dto.type,
        gamePort,
        rconPort,
        rconPassword: this.encrypt(rconPassword),
        allocatedRamMb: dto.allocatedRamMb,
        maxPlayers: dto.maxPlayers || 20,
        serverPath,
        status: ServerStatus.STOPPED,
      },
    });

    this.logger.log(`Server ${server.id} created for user ${userId}`);

    // Setup server on remote instance (async)
    this.setupServerOnRemote(server.id, instance.id, rconPassword).catch(
      (error) => {
        this.logger.error(
          `Failed to setup server ${server.id} on remote: ${error.message}`,
        );
      },
    );

    return new ServerResponseDto(server);
  }

  /**
   * Setup server on remote instance
   * - Create directory structure
   * - Download Minecraft server JAR
   * - Accept EULA
   * - Configure server.properties
   * - Create systemd service
   */
  private async setupServerOnRemote(
    serverId: string,
    instanceId: string,
    rconPassword: string,
  ): Promise<void> {
    try {
      const server = await this.prisma.minecraftServer.findUnique({
        where: { id: serverId },
        include: { instance: true },
      });

      if (!server) return;

      const instance = server.instance;
      const credentials = {
        host: instance.ipAddress,
        port: instance.sshPort,
        username: instance.sshUser,
        password: instance.sshPassword
          ? this.decrypt(instance.sshPassword)
          : undefined,
        privateKey: instance.sshKeyPath || undefined,
      };

      // Create directory structure
      const mkdirResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `mkdir -p ${server.serverPath}`,
      );
      this.logger.log(`Created directory: ${server.serverPath}`);

      // Download server JAR based on type and version
      const downloadUrl = this.getServerDownloadUrl(
        server.type,
        server.version,
      );

      this.logger.log(
        `Downloading ${server.type} ${server.version} for server ${serverId} from ${downloadUrl}`,
      );

      // Try curl first (more common on Oracle Linux), fallback to wget
      const downloadCommand = `cd ${server.serverPath} && (curl -L -o server.jar "${downloadUrl}" || wget -O server.jar "${downloadUrl}") 2>&1`;

      this.logger.log(`Download command: ${downloadCommand}`);

      const downloadResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        downloadCommand,
      );

      this.logger.log(
        `Download result stdout: ${downloadResult.stdout}`,
      );

      if (downloadResult.stderr) {
        this.logger.warn(
          `Download result stderr: ${downloadResult.stderr}`,
        );
      }

      // Verify download succeeded
      const verifyResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `ls -lh ${server.serverPath}/server.jar && stat -c%s ${server.serverPath}/server.jar`,
      );

      this.logger.log(`Server JAR verification: ${verifyResult.stdout}`);

      // Check if file is empty
      const fileSize = parseInt(verifyResult.stdout.split('\n').pop()?.trim() || '0');
      if (fileSize === 0) {
        throw new Error('Downloaded server.jar is empty (0 bytes). Download may have failed.');
      }

      this.logger.log(`Server JAR downloaded successfully: ${fileSize} bytes`);

      // Set proper permissions and ownership
      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `chmod +x ${server.serverPath}/server.jar && chown -R ${instance.sshUser}:${instance.sshUser} ${server.serverPath}`,
      );
      this.logger.log('Set permissions and ownership');

      // Disable SELinux enforcement for the directory (Oracle Linux specific)
      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `sudo setenforce 0 2>/dev/null || true`,
      );

      // Accept EULA
      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `echo "eula=true" > ${server.serverPath}/eula.txt`,
      );

      // Create server.properties
      const serverProperties = this.generateServerProperties(
        server,
        rconPassword,
      );

      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `cat > ${server.serverPath}/server.properties << 'EOF'\n${serverProperties}\nEOF`,
      );

      // Create systemd service
      const systemdService = this.generateSystemdService(server);

      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `echo '${systemdService}' | sudo tee /etc/systemd/system/${server.internalName}.service`,
      );

      // Reload systemd
      await this.sshService.executeCommand(
        instanceId,
        credentials,
        'sudo systemctl daemon-reload',
      );

      this.logger.log(`Server ${serverId} setup completed on remote instance`);
    } catch (error) {
      this.logger.error(
        `Failed to setup server ${serverId}: ${error.message}`,
      );

      // Update server status to ERROR
      await this.prisma.minecraftServer.update({
        where: { id: serverId },
        data: { status: ServerStatus.ERROR },
      });
    }
  }

  /**
   * Get all servers for a user
   */
  async findAll(userId: string): Promise<ServerResponseDto[]> {
    const servers = await this.prisma.minecraftServer.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return servers.map((server) => new ServerResponseDto(server));
  }

  /**
   * Get a specific server
   */
  async findOne(userId: string, id: string): Promise<ServerResponseDto> {
    const server = await this.prisma.minecraftServer.findFirst({
      where: { id, userId },
    });

    if (!server) {
      throw new NotFoundException('Server not found');
    }

    return new ServerResponseDto(server);
  }

  /**
   * Start a server
   */
  async start(userId: string, id: string): Promise<ServerResponseDto> {
    // Check running server limits
    await this.planLimitsService.enforceStartServerLimit(userId);

    const server = await this.prisma.minecraftServer.findFirst({
      where: { id, userId },
      include: { instance: true },
    });

    if (!server) {
      throw new NotFoundException('Server not found');
    }

    if (server.status === ServerStatus.RUNNING) {
      throw new ConflictException('Server is already running');
    }

    if (server.status === ServerStatus.STARTING) {
      throw new ConflictException('Server is already starting');
    }

    // Update status to STARTING
    await this.prisma.minecraftServer.update({
      where: { id },
      data: { status: ServerStatus.STARTING },
    });

    // Start server via systemd (async)
    this.startServerOnRemote(id).catch((error) => {
      this.logger.error(`Failed to start server ${id}: ${error.message}`);
    });

    const updatedServer = await this.prisma.minecraftServer.findUnique({
      where: { id },
    });

    return new ServerResponseDto(updatedServer!);
  }

  /**
   * Start server on remote instance
   */
  private async startServerOnRemote(serverId: string): Promise<void> {
    try {
      const server = await this.prisma.minecraftServer.findUnique({
        where: { id: serverId },
        include: { instance: true },
      });

      if (!server) return;

      const instance = server.instance;
      const credentials = {
        host: instance.ipAddress,
        port: instance.sshPort,
        username: instance.sshUser,
        password: instance.sshPassword
          ? this.decrypt(instance.sshPassword)
          : undefined,
        privateKey: instance.sshKeyPath || undefined,
      };

      // Start systemd service
      const startResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        `sudo systemctl start ${server.internalName}.service`,
      );

      this.logger.log(
        `Start command result: ${startResult.stdout} ${startResult.stderr}`,
      );

      // Wait a bit for service to initialize
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check status with error handling
      const statusResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        `sudo systemctl is-active ${server.internalName}.service || echo "inactive"`,
      );

      const statusOutput = statusResult.stdout.trim();
      const isRunning = statusOutput === 'active';

      this.logger.log(
        `Server ${serverId} status check: ${statusOutput} (isRunning: ${isRunning})`,
      );

      await this.prisma.minecraftServer.update({
        where: { id: serverId },
        data: {
          status: isRunning ? ServerStatus.RUNNING : ServerStatus.STOPPED,
          lastStartedAt: isRunning ? new Date() : undefined,
        },
      });

      if (isRunning) {
        this.logger.log(`Server ${serverId} started successfully`);
      } else {
        this.logger.warn(
          `Server ${serverId} systemd service started but not active. Status: ${statusOutput}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to start server ${serverId}: ${error.message}`,
        error.stack,
      );

      await this.prisma.minecraftServer.update({
        where: { id: serverId },
        data: { status: ServerStatus.ERROR },
      });
    }
  }

  /**
   * Stop a server
   */
  async stop(userId: string, id: string): Promise<ServerResponseDto> {
    const server = await this.prisma.minecraftServer.findFirst({
      where: { id, userId },
      include: { instance: true },
    });

    if (!server) {
      throw new NotFoundException('Server not found');
    }

    if (server.status === ServerStatus.STOPPED) {
      throw new ConflictException('Server is already stopped');
    }

    if (server.status === ServerStatus.STOPPING) {
      throw new ConflictException('Server is already stopping');
    }

    // Update status to STOPPING
    await this.prisma.minecraftServer.update({
      where: { id },
      data: { status: ServerStatus.STOPPING },
    });

    // Stop server via systemd (async)
    this.stopServerOnRemote(id).catch((error) => {
      this.logger.error(`Failed to stop server ${id}: ${error.message}`);
    });

    const updatedServer = await this.prisma.minecraftServer.findUnique({
      where: { id },
    });

    return new ServerResponseDto(updatedServer!);
  }

  /**
   * Stop server on remote instance
   */
  private async stopServerOnRemote(serverId: string): Promise<void> {
    try {
      const server = await this.prisma.minecraftServer.findUnique({
        where: { id: serverId },
        include: { instance: true },
      });

      if (!server) return;

      const instance = server.instance;
      const credentials = {
        host: instance.ipAddress,
        port: instance.sshPort,
        username: instance.sshUser,
        password: instance.sshPassword
          ? this.decrypt(instance.sshPassword)
          : undefined,
        privateKey: instance.sshKeyPath || undefined,
      };

      // Stop systemd service
      await this.sshService.executeCommand(
        instance.id,
        credentials,
        `sudo systemctl stop ${server.internalName}.service`,
      );

      await this.prisma.minecraftServer.update({
        where: { id: serverId },
        data: {
          status: ServerStatus.STOPPED,
          lastStoppedAt: new Date(),
          currentPlayers: null,
        },
      });

      this.logger.log(`Server ${serverId} stopped successfully`);
    } catch (error) {
      this.logger.error(`Failed to stop server ${serverId}: ${error.message}`);

      await this.prisma.minecraftServer.update({
        where: { id: serverId },
        data: { status: ServerStatus.ERROR },
      });
    }
  }

  /**
   * Delete a server
   */
  async remove(userId: string, id: string): Promise<void> {
    const server = await this.prisma.minecraftServer.findFirst({
      where: { id, userId },
      include: { instance: true },
    });

    if (!server) {
      throw new NotFoundException('Server not found');
    }

    if (server.status === ServerStatus.RUNNING) {
      throw new ConflictException(
        'Cannot delete a running server. Stop it first.',
      );
    }

    // Delete server files on remote (async, don't wait)
    this.deleteServerOnRemote(id).catch((error) => {
      this.logger.error(`Failed to delete server ${id} on remote: ${error.message}`);
    });

    // Delete from database
    await this.prisma.minecraftServer.delete({
      where: { id },
    });

    this.logger.log(`Server ${id} deleted for user ${userId}`);
  }

  /**
   * Delete server files and systemd service on remote
   */
  private async deleteServerOnRemote(serverId: string): Promise<void> {
    try {
      const server = await this.prisma.minecraftServer.findUnique({
        where: { id: serverId },
        include: { instance: true },
      });

      if (!server) return;

      const instance = server.instance;
      const credentials = {
        host: instance.ipAddress,
        port: instance.sshPort,
        username: instance.sshUser,
        password: instance.sshPassword
          ? this.decrypt(instance.sshPassword)
          : undefined,
        privateKey: instance.sshKeyPath || undefined,
      };

      // Disable and remove systemd service
      await this.sshService.executeCommand(
        instance.id,
        credentials,
        `sudo systemctl disable ${server.internalName}.service || true`,
      );

      await this.sshService.executeCommand(
        instance.id,
        credentials,
        `sudo rm -f /etc/systemd/system/${server.internalName}.service`,
      );

      await this.sshService.executeCommand(
        instance.id,
        credentials,
        'sudo systemctl daemon-reload',
      );

      // Delete server directory
      await this.sshService.executeCommand(
        instance.id,
        credentials,
        `rm -rf ${server.serverPath}`,
      );

      this.logger.log(`Server ${serverId} files deleted from remote instance`);
    } catch (error) {
      this.logger.error(
        `Failed to delete server ${serverId} on remote: ${error.message}`,
      );
    }
  }

  /**
   * Update server configuration
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateServerDto,
  ): Promise<ServerResponseDto> {
    const server = await this.prisma.minecraftServer.findFirst({
      where: { id, userId },
    });

    if (!server) {
      throw new NotFoundException('Server not found');
    }

    const updatedServer = await this.prisma.minecraftServer.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        allocatedRamMb: dto.allocatedRamMb,
        maxPlayers: dto.maxPlayers,
      },
    });

    return new ServerResponseDto(updatedServer);
  }

  /**
   * Get server logs and status from remote instance (for debugging)
   */
  async getServerLogs(userId: string, id: string): Promise<{
    systemdStatus: string;
    systemdLogs: string;
    serverLogs: string;
    fileExists: string;
  }> {
    const server = await this.prisma.minecraftServer.findFirst({
      where: { id, userId },
      include: { instance: true },
    });

    if (!server) {
      throw new NotFoundException('Server not found');
    }

    const instance = server.instance;
    const credentials = {
      host: instance.ipAddress,
      port: instance.sshPort,
      username: instance.sshUser,
      password: instance.sshPassword
        ? this.decrypt(instance.sshPassword)
        : undefined,
      privateKey: instance.sshKeyPath || undefined,
    };

    try {
      // Check systemd service status
      const statusResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        `sudo systemctl status ${server.internalName}.service || echo "Service not found"`,
      );

      // Get systemd logs
      const logsResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        `sudo journalctl -u ${server.internalName}.service -n 50 --no-pager || echo "No logs found"`,
      );

      // Check if server.jar exists
      const fileCheckResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        `ls -lh ${server.serverPath}/ || echo "Directory not found"`,
      );

      // Get server logs if they exist
      const serverLogsResult = await this.sshService.executeCommand(
        instance.id,
        credentials,
        `tail -n 50 ${server.serverPath}/logs/latest.log 2>/dev/null || echo "Server logs not available yet"`,
      );

      return {
        systemdStatus: statusResult.stdout + statusResult.stderr,
        systemdLogs: logsResult.stdout + logsResult.stderr,
        fileExists: fileCheckResult.stdout + fileCheckResult.stderr,
        serverLogs: serverLogsResult.stdout + serverLogsResult.stderr,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to get server logs: ${error.message}`,
      );
    }
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  private generateInternalName(name: string): string {
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .substring(0, 20);
    const random = crypto.randomBytes(4).toString('hex');
    return `mc-${sanitized}-${random}`;
  }

  private generateRconPassword(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private getServerDownloadUrl(type: string, version: string): string {
    // Paper (optimized Minecraft server) - RECOMMENDED
    if (type === 'PAPER') {
      // Paper requires a specific build number in the download URL
      // Maintain a list of known working builds for common versions
      const versionBuilds: Record<string, string> = {
        '1.20.1': '196',
        '1.20.2': '318',
        '1.20.4': '497',
        '1.21': '119',
        '1.21.1': '131',
      };

      const build = versionBuilds[version];
      if (!build) {
        throw new BadRequestException(
          `Paper version ${version} is not available. Supported versions: ${Object.keys(versionBuilds).join(', ')}. Please use one of these versions.`,
        );
      }

      // Correct Paper API download URL format
      return `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build}/downloads/paper-${version}-${build}.jar`;
    }

    // Purpur (fork of Paper with more features)
    if (type === 'PURPUR') {
      return `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
    }

    // Spigot - requires BuildTools, not directly downloadable
    if (type === 'SPIGOT') {
      throw new BadRequestException(
        'Spigot requires manual building with BuildTools. Please use PAPER instead (compatible with Spigot plugins).',
      );
    }

    // Vanilla - requires fetching version manifest from Mojang
    // For now, recommend using PAPER which is vanilla-compatible
    if (type === 'VANILLA') {
      throw new BadRequestException(
        'VANILLA server type requires additional API calls to Mojang. Please use PAPER instead, which is fully vanilla-compatible and optimized.',
      );
    }

    // Fabric and Forge require installers
    if (type === 'FABRIC' || type === 'FORGE') {
      throw new BadRequestException(
        `${type} requires running an installer. This will be supported in a future update. Please use PAPER for now.`,
      );
    }

    throw new BadRequestException(`Server type ${type} is not yet supported`);
  }

  private generateServerProperties(
    server: any,
    rconPassword: string,
  ): string {
    return `
# Minecraft server properties
server-port=${server.gamePort}
max-players=${server.maxPlayers}
motd=${server.name}
online-mode=true
difficulty=normal
gamemode=survival
pvp=true
enable-rcon=true
rcon.port=${server.rconPort}
rcon.password=${rconPassword}
view-distance=10
    `.trim();
  }

  private generateSystemdService(server: any): string {
    return `
[Unit]
Description=Minecraft Server - ${server.name}
After=network.target

[Service]
Type=simple
User=${server.instance.sshUser}
WorkingDirectory=${server.serverPath}
ExecStart=/usr/bin/java -Xmx${server.allocatedRamMb}M -Xms${server.allocatedRamMb}M -jar ${server.serverPath}/server.jar nogui
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
    `.trim();
  }

  private encrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'utf-8').slice(
      0,
      32,
    );
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'utf-8').slice(
      0,
      32,
    );
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift() || '', 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
