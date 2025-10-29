import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Rcon } from 'rcon-client';
import { PrismaService } from '../../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class RconService {
  private readonly logger = new Logger(RconService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Execute RCON command on a server
   */
  async executeCommand(
    serverId: string,
    command: string,
  ): Promise<{ response: string }> {
    const server = await this.prisma.minecraftServer.findUnique({
      where: { id: serverId },
      include: { instance: true },
    });

    if (!server) {
      throw new BadRequestException('Server not found');
    }

    if (server.status !== 'RUNNING') {
      throw new BadRequestException('Server is not running');
    }

    const rconPassword = this.decrypt(server.rconPassword);

    try {
      const rcon = await Rcon.connect({
        host: server.instance.ipAddress,
        port: server.rconPort,
        password: rconPassword,
      });

      this.logger.log(`Executing RCON command on ${server.name}: ${command}`);
      const response = await rcon.send(command);

      await rcon.end();

      return { response };
    } catch (error) {
      this.logger.error(
        `RCON command failed for server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException(
        `Failed to execute RCON command: ${error.message}`,
      );
    }
  }

  /**
   * Get current player count and list
   */
  async getPlayers(serverId: string): Promise<{
    online: number;
    max: number;
    players: string[];
  }> {
    const result = await this.executeCommand(serverId, 'list');

    // Parse the response: "There are 3 of a max of 20 players online: Player1, Player2, Player3"
    const response = result.response;

    // Extract player count
    const countMatch = response.match(/There are (\d+) of a max of (\d+)/);
    if (!countMatch) {
      throw new BadRequestException(
        'Failed to parse player count from server response',
      );
    }

    const online = parseInt(countMatch[1], 10);
    const max = parseInt(countMatch[2], 10);

    // Extract player names
    let players: string[] = [];
    const playersMatch = response.match(/online: (.+)$/);
    if (playersMatch && playersMatch[1].trim()) {
      players = playersMatch[1].split(',').map((p) => p.trim());
    }

    // Update current player count in database
    await this.prisma.minecraftServer.update({
      where: { id: serverId },
      data: { currentPlayers: online },
    });

    return {
      online,
      max,
      players,
    };
  }

  /**
   * Stop server gracefully via RCON
   */
  async stopServer(serverId: string): Promise<void> {
    await this.executeCommand(serverId, 'stop');
  }

  /**
   * Broadcast a message to all players
   */
  async broadcast(serverId: string, message: string): Promise<void> {
    await this.executeCommand(serverId, `say ${message}`);
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
