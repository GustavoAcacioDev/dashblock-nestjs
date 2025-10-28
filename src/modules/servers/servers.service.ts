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
import axios from 'axios';

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    private prisma: PrismaService,
    private sshService: SshService,
    private planLimitsService: PlanLimitsService,
    private portAllocationService: PortAllocationService,
  ) { }

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
        privateKey: instance.sshKey ? this.decrypt(instance.sshKey) : undefined,
      };

      // Create directory structure
      const mkdirResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `mkdir -p ${server.serverPath}`,
      );
      this.logger.log(`Created directory: ${server.serverPath}`);

      // Download/Install server based on type
      let downloadUrl = this.getServerDownloadUrl(server.type, server.version);

      // Handle VANILLA - fetch real URL from Mojang API
      if (downloadUrl.startsWith('VANILLA:')) {
        downloadUrl = await this.getVanillaDownloadUrl(server.version);
      }

      // Handle FABRIC - run installer
      if (downloadUrl.startsWith('FABRIC:')) {
        await this.installFabricServer(
          instanceId,
          credentials,
          server.serverPath,
          server.version,
        );
        // Skip normal download process
      } else if (downloadUrl.startsWith('FORGE:')) {
        // Handle FORGE - run installer
        await this.installForgeServer(
          instanceId,
          credentials,
          server.serverPath,
          server.version,
        );
        // Skip normal download process
      } else {
        // Normal download process for PAPER, PURPUR, VANILLA (not FABRIC or FORGE)
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

        this.logger.log(`Download result stdout: ${downloadResult.stdout}`);

        if (downloadResult.stderr) {
          this.logger.warn(`Download result stderr: ${downloadResult.stderr}`);
        }

        // Verify download succeeded
        const verifyResult = await this.sshService.executeCommand(
          instanceId,
          credentials,
          `ls -lh ${server.serverPath}/server.jar && stat -c%s ${server.serverPath}/server.jar`,
        );

        this.logger.log(`Server JAR verification: ${verifyResult.stdout}`);

        // Check if file is empty
        const fileSize = parseInt(
          verifyResult.stdout.split('\n').pop()?.trim() || '0',
        );
        if (fileSize === 0) {
          throw new Error(
            'Downloaded server.jar is empty (0 bytes). Download may have failed.',
          );
        }

        this.logger.log(
          `Server JAR downloaded successfully: ${fileSize} bytes`,
        );
      }

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
      // Check if this is a Forge server with run.sh
      const forgeRunShCheck = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `test -f ${server.serverPath}/.forge_uses_runsh && echo "true" || echo "false"`,
      );
      const usesForgeRunSh = forgeRunShCheck.stdout.trim() === 'true';

      const systemdService = this.generateSystemdService(
        server,
        usesForgeRunSh,
      );

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
      this.logger.error(`Failed to setup server ${serverId}: ${error.message}`);

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
        privateKey: instance.sshKey ? this.decrypt(instance.sshKey) : undefined,
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
        privateKey: instance.sshKey ? this.decrypt(instance.sshKey) : undefined,
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
      this.logger.error(
        `Failed to delete server ${id} on remote: ${error.message}`,
      );
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
        privateKey: instance.sshKey ? this.decrypt(instance.sshKey) : undefined,
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
  async getServerLogs(
    userId: string,
    id: string,
  ): Promise<{
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
      privateKey: instance.sshKey ? this.decrypt(instance.sshKey) : undefined,
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

    // VANILLA - Will be fetched from Mojang API (returns placeholder, actual fetch happens async)
    if (type === 'VANILLA') {
      // Return placeholder - we'll fetch the real URL in setupServerOnRemote
      return `VANILLA:${version}`;
    }

    // FABRIC - Will use installer (returns placeholder, actual install happens async)
    if (type === 'FABRIC') {
      // Return placeholder - we'll run Fabric installer in setupServerOnRemote
      return `FABRIC:${version}`;
    }

    // Spigot - requires BuildTools, not directly downloadable
    if (type === 'SPIGOT') {
      throw new BadRequestException(
        'Spigot requires manual building with BuildTools. Please use PAPER instead (compatible with Spigot plugins).',
      );
    }

    // FORGE - Will use installer (returns placeholder, actual install happens async)
    if (type === 'FORGE') {
      // Return placeholder - we'll run Forge installer in setupServerOnRemote
      return `FORGE:${version}`;
    }

    throw new BadRequestException(`Server type ${type} is not yet supported`);
  }

  /**
   * Fetch VANILLA server download URL from Mojang API
   */
  private async getVanillaDownloadUrl(version: string): Promise<string> {
    try {
      this.logger.log(
        `Fetching VANILLA server URL for version ${version} from Mojang API`,
      );

      // 1. Fetch version manifest
      const manifestResponse = await axios.get(
        'https://launchermeta.mojang.com/mc/game/version_manifest.json',
      );

      // 2. Find the requested version
      const versionData = manifestResponse.data.versions.find(
        (v: any) => v.id === version,
      );

      if (!versionData) {
        throw new BadRequestException(
          `Vanilla version ${version} not found in Mojang's version manifest`,
        );
      }

      this.logger.log(
        `Found version data for ${version}, fetching download details...`,
      );

      // 3. Fetch version-specific info
      const versionInfoResponse = await axios.get(versionData.url);

      // 4. Get server JAR URL
      const serverUrl = versionInfoResponse.data.downloads?.server?.url;

      if (!serverUrl) {
        throw new BadRequestException(
          `No server download available for Vanilla version ${version}`,
        );
      }

      this.logger.log(`Found VANILLA server URL: ${serverUrl}`);
      return serverUrl;
    } catch (error) {
      this.logger.error(
        `Failed to fetch VANILLA download URL: ${error.message}`,
      );
      throw new BadRequestException(
        `Failed to fetch VANILLA server for version ${version}: ${error.message}`,
      );
    }
  }

  /**
   * Install and setup FABRIC server
   */
  private async installFabricServer(
    instanceId: string,
    credentials: any,
    serverPath: string,
    version: string,
  ): Promise<void> {
    try {
      this.logger.log(`Installing FABRIC server for Minecraft ${version}`);

      // Fabric installer version (latest stable)
      const fabricInstallerVersion = '1.0.1';
      const fabricInstallerUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${fabricInstallerVersion}/fabric-installer-${fabricInstallerVersion}.jar`;

      // Download Fabric installer
      this.logger.log('Downloading Fabric installer...');
      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `cd ${serverPath} && curl -L -o fabric-installer.jar "${fabricInstallerUrl}"`,
      );

      // Run Fabric installer
      this.logger.log('Running Fabric installer...');
      const installResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `cd ${serverPath} && java -jar fabric-installer.jar server -mcversion ${version} -downloadMinecraft 2>&1`,
      );

      this.logger.log(`Fabric installer output: ${installResult.stdout}`);

      // Check what files were created
      const filesResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `ls -lh ${serverPath}/`,
      );
      this.logger.log(`Fabric directory contents: ${filesResult.stdout}`);

      // Fabric creates a launch script, we need to use the actual server JAR
      // The real server is in libraries/net/minecraft/server/{version}/server-{version}.jar
      // But we should use the fabric-server-launch.jar which handles classpath

      // Check if fabric-server-launch.jar exists
      const launchJarCheck = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `test -f ${serverPath}/fabric-server-launch.jar && echo "exists" || echo "not found"`,
      );

      if (launchJarCheck.stdout.trim() === 'exists') {
        // Use fabric-server-launch.jar (the proper way)
        await this.sshService.executeCommand(
          instanceId,
          credentials,
          `cd ${serverPath} && cp fabric-server-launch.jar server.jar`,
        );
        this.logger.log('Using fabric-server-launch.jar as server.jar');
      } else {
        // Fallback: try to find any fabric server JAR
        const findJarResult = await this.sshService.executeCommand(
          instanceId,
          credentials,
          `find ${serverPath} -name "fabric-server-*.jar" -type f | head -1`,
        );

        const jarPath = findJarResult.stdout.trim();
        if (jarPath) {
          await this.sshService.executeCommand(
            instanceId,
            credentials,
            `cp "${jarPath}" ${serverPath}/server.jar`,
          );
          this.logger.log(`Using ${jarPath} as server.jar`);
        } else {
          throw new Error(
            'Could not find Fabric server JAR after installation',
          );
        }
      }

      // Verify server.jar was created
      const verifyResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `ls -lh ${serverPath}/server.jar && file ${serverPath}/server.jar`,
      );

      this.logger.log(`Fabric server JAR verification: ${verifyResult.stdout}`);

      // Clean up installer
      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `rm -f ${serverPath}/fabric-installer.jar`,
      );

      this.logger.log('Fabric server installation completed');
    } catch (error) {
      this.logger.error(`Failed to install Fabric server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Install and setup FORGE server
   */
  private async installForgeServer(
    instanceId: string,
    credentials: any,
    serverPath: string,
    version: string,
  ): Promise<void> {
    try {
      this.logger.log(`Installing FORGE server for Minecraft ${version}`);

      // Map of known Forge versions for common Minecraft versions
      const forgeVersions: Record<string, string> = {
        '1.20.1': '47.3.0',
        '1.20.2': '48.1.0',
        '1.20.4': '49.1.0',
        '1.21': '51.0.33',
        '1.21.1': '52.0.16',
      };

      const forgeVersion = forgeVersions[version];
      if (!forgeVersion) {
        throw new BadRequestException(
          `Forge version for Minecraft ${version} is not available. Supported versions: ${Object.keys(forgeVersions).join(', ')}`,
        );
      }

      // Forge installer URL format
      const forgeInstallerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeVersion}/forge-${version}-${forgeVersion}-installer.jar`;

      this.logger.log(`Forge installer URL: ${forgeInstallerUrl}`);

      // Download Forge installer
      this.logger.log('Downloading Forge installer...');
      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `cd ${serverPath} && curl -L -o forge-installer.jar "${forgeInstallerUrl}"`,
      );

      // Run Forge installer in server install mode
      this.logger.log('Running Forge installer...');
      const installResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `cd ${serverPath} && java -jar forge-installer.jar --installServer 2>&1`,
      );

      this.logger.log(`Forge installer output: ${installResult.stdout}`);

      // Check what files were created
      const filesResult = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `ls -lh ${serverPath}/`,
      );
      this.logger.log(`Forge directory contents: ${filesResult.stdout}`);

      // Forge creates different JAR names depending on the version
      // Common patterns: forge-{version}-{forgeVersion}.jar, forge-{version}-{forgeVersion}-shim.jar, run.sh
      // Modern Forge versions use run.sh script, older versions have direct JAR

      // Check for run.sh (modern Forge)
      const runShCheck = await this.sshService.executeCommand(
        instanceId,
        credentials,
        `test -f ${serverPath}/run.sh && echo "exists" || echo "not found"`,
      );

      if (runShCheck.stdout.trim() === 'exists') {
        // Modern Forge with run.sh - create a wrapper script
        this.logger.log('Using modern Forge with run.sh script');

        // Make run.sh executable
        await this.sshService.executeCommand(
          instanceId,
          credentials,
          `chmod +x ${serverPath}/run.sh`,
        );

        // For systemd, we'll modify the service to use run.sh instead of server.jar
        // Create a marker file to indicate this is a Forge server with run.sh
        await this.sshService.executeCommand(
          instanceId,
          credentials,
          `touch ${serverPath}/.forge_uses_runsh`,
        );

        this.logger.log('Forge server will use run.sh for startup');
      } else {
        // Legacy Forge - find the server JAR
        const findJarResult = await this.sshService.executeCommand(
          instanceId,
          credentials,
          `find ${serverPath} -name "forge-*.jar" -o -name "minecraft_server.*.jar" | grep -v installer | head -1`,
        );

        const jarPath = findJarResult.stdout.trim();
        if (jarPath) {
          await this.sshService.executeCommand(
            instanceId,
            credentials,
            `cp "${jarPath}" ${serverPath}/server.jar`,
          );
          this.logger.log(`Using ${jarPath} as server.jar`);
        } else {
          throw new Error('Could not find Forge server JAR after installation');
        }
      }

      // Clean up installer
      await this.sshService.executeCommand(
        instanceId,
        credentials,
        `rm -f ${serverPath}/forge-installer.jar ${serverPath}/forge-installer.jar.log`,
      );

      this.logger.log('Forge server installation completed');
    } catch (error) {
      this.logger.error(`Failed to install Forge server: ${error.message}`);
      throw error;
    }
  }

  private generateServerProperties(server: any, rconPassword: string): string {
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

  private generateSystemdService(
    server: any,
    useForgeRunSh: boolean = false,
  ): string {
    // Determine ExecStart command based on server type
    let execStart: string;

    if (useForgeRunSh) {
      // Modern Forge servers use run.sh script
      execStart = `${server.serverPath}/run.sh nogui`;
    } else {
      // Standard Java command for all other server types
      execStart = `/usr/bin/java -Xmx${server.allocatedRamMb}M -Xms${server.allocatedRamMb}M -jar ${server.serverPath}/server.jar nogui`;
    }

    return `
[Unit]
Description=Minecraft Server - ${server.name}
After=network.target

[Service]
Type=simple
User=${server.instance.sshUser}
WorkingDirectory=${server.serverPath}
ExecStart=${execStart}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
    `.trim();
  }

  private encrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const encryptionKey =
      process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
    // Use scrypt to derive a proper 32-byte key from any length string
    const key = crypto.scryptSync(encryptionKey, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const encryptionKey =
      process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
    // Use scrypt to derive a proper 32-byte key from any length string
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
