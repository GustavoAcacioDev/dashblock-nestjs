import {
  Injectable,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Port allocation result
 */
interface PortAllocation {
  gamePort: number;
  rconPort: number;
}

/**
 * Port availability check result
 */
interface PortAvailability {
  isAvailable: boolean;
  nextAvailableGamePort?: number;
  nextAvailableRconPort?: number;
}

@Injectable()
export class PortAllocationService {
  private readonly logger = new Logger(PortAllocationService.name);

  /**
   * Port ranges for Minecraft servers
   * These are standard Minecraft port ranges
   */
  private readonly GAME_PORT_START = 25565;
  private readonly GAME_PORT_END = 25664;   // Allows 100 game servers
  private readonly RCON_PORT_START = 25665;
  private readonly RCON_PORT_END = 25764;   // Allows 100 RCON ports

  constructor(private prisma: PrismaService) {}

  /**
   * Allocate unique ports for a new server
   * @param instanceId - The instance where server will be created
   * @returns Port allocation with gamePort and rconPort
   * @throws ConflictException if no ports are available
   */
  async allocatePorts(instanceId: string): Promise<PortAllocation> {
    // Get all servers on this instance to check port usage
    const serversOnInstance = await this.prisma.minecraftServer.findMany({
      where: { instanceId },
      select: {
        gamePort: true,
        rconPort: true,
      },
    });

    // Find next available game port
    const usedGamePorts = new Set<number>(serversOnInstance.map(s => s.gamePort));
    const gamePort = this.findNextAvailablePort(
      usedGamePorts,
      this.GAME_PORT_START,
      this.GAME_PORT_END,
    );

    if (gamePort === null) {
      throw new ConflictException(
        `No available game ports on this instance. Maximum capacity (${this.GAME_PORT_END - this.GAME_PORT_START + 1} servers) reached.`,
      );
    }

    // Find next available RCON port
    const usedRconPorts = new Set<number>(serversOnInstance.map(s => s.rconPort));
    const rconPort = this.findNextAvailablePort(
      usedRconPorts,
      this.RCON_PORT_START,
      this.RCON_PORT_END,
    );

    if (rconPort === null) {
      throw new ConflictException(
        `No available RCON ports on this instance. Maximum capacity reached.`,
      );
    }

    this.logger.log(
      `Allocated ports for instance ${instanceId}: game=${gamePort}, rcon=${rconPort}`,
    );

    return { gamePort, rconPort };
  }

  /**
   * Check if specific ports are available
   * @param instanceId - The instance to check
   * @param gamePort - Desired game port
   * @param rconPort - Desired RCON port
   * @returns Whether both ports are available
   */
  async arePortsAvailable(
    instanceId: string,
    gamePort: number,
    rconPort: number,
  ): Promise<boolean> {
    const existingServer = await this.prisma.minecraftServer.findFirst({
      where: {
        instanceId,
        OR: [
          { gamePort },
          { rconPort },
        ],
      },
    });

    return existingServer === null;
  }

  /**
   * Get port usage statistics for an instance
   * @param instanceId - The instance to check
   * @returns Port usage information
   */
  async getPortUsageStats(instanceId: string): Promise<{
    usedGamePorts: number;
    availableGamePorts: number;
    usedRconPorts: number;
    availableRconPorts: number;
    totalCapacity: number;
    usedCapacity: number;
  }> {
    const servers = await this.prisma.minecraftServer.findMany({
      where: { instanceId },
      select: {
        gamePort: true,
        rconPort: true,
      },
    });

    const totalGamePorts = this.GAME_PORT_END - this.GAME_PORT_START + 1;
    const totalRconPorts = this.RCON_PORT_END - this.RCON_PORT_START + 1;

    return {
      usedGamePorts: servers.length,
      availableGamePorts: totalGamePorts - servers.length,
      usedRconPorts: servers.length,
      availableRconPorts: totalRconPorts - servers.length,
      totalCapacity: Math.min(totalGamePorts, totalRconPorts),
      usedCapacity: servers.length,
    };
  }

  /**
   * Validate that a port is within the allowed range
   * @param port - Port to validate
   * @param type - Port type ('game' or 'rcon')
   * @returns Whether the port is valid
   */
  isValidPort(port: number, type: 'game' | 'rcon'): boolean {
    if (type === 'game') {
      return port >= this.GAME_PORT_START && port <= this.GAME_PORT_END;
    } else {
      return port >= this.RCON_PORT_START && port <= this.RCON_PORT_END;
    }
  }

  /**
   * Find the next available port in a range
   * @param usedPorts - Set of ports already in use
   * @param startPort - Start of port range
   * @param endPort - End of port range
   * @returns Next available port, or null if all are used
   */
  private findNextAvailablePort(
    usedPorts: Set<number>,
    startPort: number,
    endPort: number,
  ): number | null {
    for (let port = startPort; port <= endPort; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    return null;
  }

  /**
   * Get all used ports on an instance
   * Useful for debugging or admin panels
   * @param instanceId - The instance to check
   */
  async getUsedPorts(instanceId: string): Promise<{
    gamePorts: number[];
    rconPorts: number[];
  }> {
    const servers = await this.prisma.minecraftServer.findMany({
      where: { instanceId },
      select: {
        gamePort: true,
        rconPort: true,
        name: true,
      },
      orderBy: {
        gamePort: 'asc',
      },
    });

    return {
      gamePorts: servers.map(s => s.gamePort),
      rconPorts: servers.map(s => s.rconPort),
    };
  }

  /**
   * Reserve specific ports (for advanced users)
   * @param instanceId - The instance
   * @param gamePort - Desired game port
   * @param rconPort - Desired RCON port
   * @throws ConflictException if ports are already in use
   */
  async reservePorts(
    instanceId: string,
    gamePort: number,
    rconPort: number,
  ): Promise<PortAllocation> {
    // Validate ports are in range
    if (!this.isValidPort(gamePort, 'game')) {
      throw new ConflictException(
        `Game port ${gamePort} is outside allowed range (${this.GAME_PORT_START}-${this.GAME_PORT_END})`,
      );
    }

    if (!this.isValidPort(rconPort, 'rcon')) {
      throw new ConflictException(
        `RCON port ${rconPort} is outside allowed range (${this.RCON_PORT_START}-${this.RCON_PORT_END})`,
      );
    }

    // Check if ports are available
    const available = await this.arePortsAvailable(instanceId, gamePort, rconPort);

    if (!available) {
      throw new ConflictException(
        `Ports ${gamePort} or ${rconPort} are already in use on this instance`,
      );
    }

    this.logger.log(
      `Reserved specific ports for instance ${instanceId}: game=${gamePort}, rcon=${rconPort}`,
    );

    return { gamePort, rconPort };
  }

  /**
   * Get port ranges configuration
   * Useful for documentation or UI
   */
  getPortRanges(): {
    game: { start: number; end: number };
    rcon: { start: number; end: number };
  } {
    return {
      game: {
        start: this.GAME_PORT_START,
        end: this.GAME_PORT_END,
      },
      rcon: {
        start: this.RCON_PORT_START,
        end: this.RCON_PORT_END,
      },
    };
  }
}
