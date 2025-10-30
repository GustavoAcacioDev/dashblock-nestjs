import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SshService } from '../../ssh/ssh.service';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { fileTypeFromFile } from 'file-type';

@Injectable()
export class FileManagementService {
  private readonly logger = new Logger(FileManagementService.name);

  // File upload configuration
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  private readonly ALLOWED_EXTENSIONS = [
    '.jar',
    '.zip',
    '.json',
    '.toml',
    '.yml',
    '.yaml',
    '.properties',
    '.txt',
    '.cfg',
    '.conf',
  ];

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

    // Resolve and validate path (SECURITY FIX: prevent path traversal)
    let fullPath: string;
    if (!requestedPath || requestedPath === '.' || requestedPath === '') {
      // Default to server root
      fullPath = server.serverPath;
    } else {
      // Strip leading slash if present to treat all paths as relative
      const relativePath = requestedPath.startsWith('/')
        ? requestedPath.slice(1)
        : requestedPath;

      // Use path.posix.join to combine paths (safer than resolve for relative paths)
      fullPath = path.posix.join(server.serverPath, relativePath);

      // Normalize to resolve any .. or . components
      fullPath = path.posix.normalize(fullPath);
    }

    // Security check: ensure normalized path is within server directory
    // This prevents attacks like: ../../../etc/passwd
    const normalizedServerPath = server.serverPath.endsWith('/')
      ? server.serverPath.slice(0, -1)
      : server.serverPath;
    if (!fullPath.startsWith(normalizedServerPath + '/') && fullPath !== normalizedServerPath) {
      throw new BadRequestException(
        'Access denied: Path traversal detected',
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

  /**
   * Upload a file to the server
   */
  async uploadFile(
    serverId: string,
    file: Express.Multer.File,
    destinationPath: string = '.',
  ): Promise<{ message: string; path: string }> {
    // Validate file
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Check file size
    if (file.size > this.MAX_FILE_SIZE) {
      // Clean up rejected file
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
      throw new BadRequestException(
        `File too large. Maximum size is ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // SECURITY FIX: Sanitize filename to remove path components
    // This prevents attacks like: ../../evil.jar
    const sanitizedFilename = path.basename(file.originalname);

    // Validate filename doesn't contain dangerous characters
    if (!/^[a-zA-Z0-9._-]+$/.test(sanitizedFilename)) {
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
      throw new BadRequestException(
        'Invalid filename. Only alphanumeric characters, dots, dashes, and underscores are allowed.',
      );
    }

    // Check file extension
    const fileExt = path.extname(sanitizedFilename).toLowerCase();
    if (!this.ALLOWED_EXTENSIONS.includes(fileExt)) {
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
      throw new BadRequestException(
        `File type not allowed. Allowed types: ${this.ALLOWED_EXTENSIONS.join(', ')}`,
      );
    }

    // SECURITY: Validate file type by magic number (not just extension)
    // This prevents attacks like renaming virus.exe to virus.jar
    try {
      const fileType = await fileTypeFromFile(file.path);

      // Define allowed MIME types
      const allowedMimeTypes = [
        'application/java-archive', // .jar
        'application/zip',          // .zip
        'application/x-zip-compressed',
        'application/json',         // .json
        'text/plain',               // .txt, .toml, .yml, .properties, .cfg, .conf
      ];

      // For .jar and .zip files, verify they are actually zip files
      if (['.jar', '.zip'].includes(fileExt)) {
        if (fileType && !fileType.mime.includes('zip') && !fileType.mime.includes('java-archive')) {
          try {
            fs.unlinkSync(file.path);
          } catch (err) {
            // Ignore cleanup errors
          }
          throw new BadRequestException(
            'File content does not match extension. Possible file type spoofing.',
          );
        }
      }

      // For text-based files (.json, .toml, .yml, .txt, etc.)
      // file-type may return null for text files, which is acceptable
      if (fileType && !allowedMimeTypes.includes(fileType.mime)) {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          // Ignore cleanup errors
        }
        this.logger.warn(
          `Rejected file with unexpected MIME type: ${fileType.mime} for extension ${fileExt}`,
        );
        throw new BadRequestException(
          'File content does not match extension.',
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      // If file-type fails, log but continue (text files may not have magic numbers)
      this.logger.warn(`File type detection failed: ${error.message}`);
    }

    const server = await this.prisma.minecraftServer.findUnique({
      where: { id: serverId },
      include: { instance: true },
    });

    if (!server) {
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
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

    // SECURITY FIX: Resolve and validate destination path
    let destinationDir: string;
    if (!destinationPath || destinationPath === '.' || destinationPath === '') {
      destinationDir = server.serverPath;
    } else {
      // Strip leading slash if present to treat all paths as relative
      const relativePath = destinationPath.startsWith('/')
        ? destinationPath.slice(1)
        : destinationPath;

      // Use path.posix.join to combine paths (safer than resolve for relative paths)
      destinationDir = path.posix.join(server.serverPath, relativePath);

      // Normalize to resolve any .. or . components
      destinationDir = path.posix.normalize(destinationDir);
    }

    // Security check: ensure destination is within server directory
    const normalizedServerPath = server.serverPath.endsWith('/')
      ? server.serverPath.slice(0, -1)
      : server.serverPath;
    if (!destinationDir.startsWith(normalizedServerPath + '/') && destinationDir !== normalizedServerPath) {
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
      throw new BadRequestException(
        'Access denied: Path traversal detected',
      );
    }

    // Build final remote path with sanitized filename
    const remotePath = path.posix.join(destinationDir, sanitizedFilename);

    // Check if file already exists (optional overwrite protection)
    // You can add logic here to check if file exists and prompt user

    try {
      this.logger.log(
        `Uploading file ${sanitizedFilename} (${file.size} bytes) to ${remotePath}`,
      );

      // Upload via SFTP
      await this.sshService.uploadFile(
        instance.id,
        credentials,
        file.path,
        remotePath,
      );

      // Clean up temporary file (FIX: no race condition)
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        this.logger.warn(`Failed to delete temp file: ${err.message}`);
      }

      this.logger.log(`File uploaded successfully: ${remotePath}`);

      return {
        message: 'File uploaded successfully',
        path: remotePath,
      };
    } catch (error) {
      // Clean up temporary file on error (FIX: no race condition)
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }

      this.logger.error(
        `Failed to upload file to server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to upload file');
    }
  }

  /**
   * Delete a file from the server
   */
  async deleteFile(
    serverId: string,
    filePath: string,
  ): Promise<{ message: string }> {
    if (!filePath || filePath.trim() === '') {
      throw new BadRequestException('File path is required');
    }

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

    // SECURITY FIX: Resolve and normalize path to prevent traversal
    // Strip leading slash if present to treat all paths as relative
    const relativePath = filePath.startsWith('/')
      ? filePath.slice(1)
      : filePath;

    // Use path.posix.join to combine paths (safer than resolve for relative paths)
    let fullPath = path.posix.join(server.serverPath, relativePath);

    // Normalize to resolve any .. or . components
    fullPath = path.posix.normalize(fullPath);

    // Security check: ensure normalized path is within server directory
    const normalizedServerPath = server.serverPath.endsWith('/')
      ? server.serverPath.slice(0, -1)
      : server.serverPath;
    if (!fullPath.startsWith(normalizedServerPath + '/') && fullPath !== normalizedServerPath) {
      throw new BadRequestException(
        'Access denied: Path traversal detected',
      );
    }

    // Prevent deletion of server root directory
    if (fullPath === normalizedServerPath) {
      throw new BadRequestException(
        'Cannot delete server root directory',
      );
    }

    try {
      await this.sshService.deleteFile(instance.id, credentials, fullPath);

      this.logger.log(`File deleted successfully: ${path.basename(fullPath)}`);

      return {
        message: 'File deleted successfully',
      };
    } catch (error) {
      this.logger.error(
        `Failed to delete file from server ${serverId}`,
      );
      throw new BadRequestException('Failed to delete file');
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
