import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SshService } from '../../ssh/ssh.service';
import * as crypto from 'crypto';
import * as path from 'path';

@Injectable()
export class FileManagementService {
  private readonly logger = new Logger(FileManagementService.name);

  constructor(
    private prisma: PrismaService,
    private sshService: SshService,
  ) {}

  /**
   * Browse files in a server directory
   */
  async browseServerFiles(
    serverId: string,
    requestedPath: string = '.',
  ): Promise<{ current_path: string; entries: any[] }> {
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

    // Resolve the full path
    let fullPath: string;
    if (requestedPath === '.' || requestedPath === '' || !requestedPath) {
      // Default to server root
      fullPath = server.serverPath;
    } else if (path.isAbsolute(requestedPath)) {
      // Absolute path - validate it's within server directory
      fullPath = requestedPath;
    } else {
      // Relative path - join with server path
      fullPath = path.posix.join(server.serverPath, requestedPath);
    }

    // Security check: ensure path is within server directory
    if (!fullPath.startsWith(server.serverPath)) {
      throw new BadRequestException(
        'Access denied: Cannot navigate outside server directory',
      );
    }

    try {
      const result = await this.sshService.listDirectory(
        instance.id,
        credentials,
        fullPath,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to browse files for server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException(
        `Failed to list directory: ${error.message}`,
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
