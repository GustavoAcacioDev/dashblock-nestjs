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

  // SECURITY: Context-aware file type restrictions based on destination
  private readonly FILE_TYPE_RULES = {
    // Executable/plugin directories - only JAR files
    '/mods': ['.jar'],
    '/plugins': ['.jar'],

    // Config directories - only config files
    '/config': ['.json', '.toml', '.yml', '.yaml', '.properties', '.txt', '.cfg', '.conf'],

    // Root directory - config files only (server.properties, eula.txt, etc.)
    '.': ['.json', '.toml', '.yml', '.yaml', '.properties', '.txt', '.cfg', '.conf'],

    // World directories - allow world files
    '/world': ['.dat', '.mca', '.json', '.txt'],
    '/world_nether': ['.dat', '.mca', '.json', '.txt'],
    '/world_the_end': ['.dat', '.mca', '.json', '.txt'],

    // Datapack/resourcepack directories
    '/datapacks': ['.zip', '.json'],
    '/resourcepacks': ['.zip'],
  };

  // Default allowed extensions if path doesn't match specific rules
  private readonly DEFAULT_ALLOWED_EXTENSIONS = [
    '.jar',
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
   * Get allowed file extensions for a given destination path
   * SECURITY: Context-aware file type restrictions
   */
  private getAllowedExtensions(destinationPath: string): string[] {
    // Normalize the path
    const normalizedPath = destinationPath.startsWith('/')
      ? destinationPath
      : '/' + destinationPath;

    // Check if path matches any specific rule
    for (const [rulePath, extensions] of Object.entries(this.FILE_TYPE_RULES)) {
      if (rulePath === '.' && (destinationPath === '.' || destinationPath === '')) {
        return extensions;
      }
      if (normalizedPath.startsWith(rulePath) || normalizedPath.includes(rulePath)) {
        return extensions;
      }
    }

    // Return default extensions if no specific rule matches
    return this.DEFAULT_ALLOWED_EXTENSIONS;
  }

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

    // SECURITY: Get allowed extensions based on destination path
    const allowedExtensions = this.getAllowedExtensions(destinationPath);

    // Check file extension
    const fileExt = path.extname(sanitizedFilename).toLowerCase();
    if (!allowedExtensions.includes(fileExt)) {
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
      throw new BadRequestException(
        `File type not allowed for this directory. Allowed types: ${allowedExtensions.join(', ')}`,
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
   * Download a file from the server
   */
  async downloadFile(
    serverId: string,
    filePath: string,
  ): Promise<{ localPath: string; filename: string; cleanup: () => void }> {
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
    const relativePath = filePath.startsWith('/')
      ? filePath.slice(1)
      : filePath;

    let fullPath = path.posix.join(server.serverPath, relativePath);
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

    // Prevent downloading server root directory
    if (fullPath === normalizedServerPath) {
      throw new BadRequestException(
        'Cannot download server root directory',
      );
    }

    try {
      // Create temp directory if it doesn't exist
      const tempDir = path.join(process.cwd(), 'downloads');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Generate unique temporary filename
      const filename = path.basename(fullPath);
      const tempFilename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${filename}`;
      const localPath = path.join(tempDir, tempFilename);

      // Download via SFTP
      await this.sshService.downloadFile(
        instance.id,
        credentials,
        fullPath,
        localPath,
      );

      this.logger.log(`File downloaded successfully: ${filename}`);

      // Return path and cleanup function
      return {
        localPath,
        filename,
        cleanup: () => {
          try {
            if (fs.existsSync(localPath)) {
              fs.unlinkSync(localPath);
              this.logger.log(`Cleaned up temp file: ${tempFilename}`);
            }
          } catch (err) {
            this.logger.warn(`Failed to cleanup temp file: ${err.message}`);
          }
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to download file from server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to download file');
    }
  }

  /**
   * Read file content from the server
   * Only for text-based files (configs, logs, etc.)
   */
  async readFileContent(
    serverId: string,
    filePath: string,
  ): Promise<{ content: string; filename: string }> {
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

    // SECURITY: Resolve and normalize path
    const relativePath = filePath.startsWith('/')
      ? filePath.slice(1)
      : filePath;

    let fullPath = path.posix.join(server.serverPath, relativePath);
    fullPath = path.posix.normalize(fullPath);

    // Security check
    const normalizedServerPath = server.serverPath.endsWith('/')
      ? server.serverPath.slice(0, -1)
      : server.serverPath;
    if (!fullPath.startsWith(normalizedServerPath + '/') && fullPath !== normalizedServerPath) {
      throw new BadRequestException(
        'Access denied: Path traversal detected',
      );
    }

    // Validate file extension (only allow text-based files)
    const fileExt = path.extname(fullPath).toLowerCase();
    const editableExtensions = [
      '.properties',
      '.yml',
      '.yaml',
      '.json',
      '.toml',
      '.txt',
      '.cfg',
      '.conf',
      '.log',
    ];

    if (!editableExtensions.includes(fileExt)) {
      throw new BadRequestException(
        `File type not editable. Editable types: ${editableExtensions.join(', ')}`,
      );
    }

    try {
      // Read file content via SSH
      const result = await this.sshService.executeCommand(
        instance.id,
        credentials,
        `cat "${fullPath}"`,
      );

      this.logger.log(`File read successfully: ${path.basename(fullPath)}`);

      return {
        content: result.stdout.trim(),
        filename: path.basename(fullPath),
      };
    } catch (error) {
      this.logger.error(
        `Failed to read file from server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to read file content');
    }
  }

  /**
   * Write file content to the server
   * Only for text-based files (configs, etc.)
   */
  async writeFileContent(
    serverId: string,
    filePath: string,
    content: string,
  ): Promise<{ message: string }> {
    if (!filePath || filePath.trim() === '') {
      throw new BadRequestException('File path is required');
    }

    if (content === undefined || content === null) {
      throw new BadRequestException('File content is required');
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

    // SECURITY: Resolve and normalize path
    const relativePath = filePath.startsWith('/')
      ? filePath.slice(1)
      : filePath;

    let fullPath = path.posix.join(server.serverPath, relativePath);
    fullPath = path.posix.normalize(fullPath);

    // Security check
    const normalizedServerPath = server.serverPath.endsWith('/')
      ? server.serverPath.slice(0, -1)
      : server.serverPath;
    if (!fullPath.startsWith(normalizedServerPath + '/') && fullPath !== normalizedServerPath) {
      throw new BadRequestException(
        'Access denied: Path traversal detected',
      );
    }

    // Validate file extension (only allow text-based files)
    const fileExt = path.extname(fullPath).toLowerCase();
    const editableExtensions = [
      '.properties',
      '.yml',
      '.yaml',
      '.json',
      '.toml',
      '.txt',
      '.cfg',
      '.conf',
    ];

    if (!editableExtensions.includes(fileExt)) {
      throw new BadRequestException(
        `File type not editable. Editable types: ${editableExtensions.join(', ')}`,
      );
    }

    try {
      // Escape content for shell - use base64 encoding to safely transfer content
      const encodedContent = Buffer.from(content).toString('base64');

      // Write file content via SSH using base64 decode
      await this.sshService.executeCommand(
        instance.id,
        credentials,
        `echo "${encodedContent}" | base64 -d > "${fullPath}"`,
      );

      this.logger.log(`File written successfully: ${path.basename(fullPath)}`);

      return {
        message: 'File saved successfully',
      };
    } catch (error) {
      this.logger.error(
        `Failed to write file to server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to save file content');
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

  /**
   * Reset server world (delete world folders)
   */
  async resetWorld(
    serverId: string,
    worldType: 'overworld' | 'nether' | 'end' | 'all' = 'all',
  ): Promise<{ message: string }> {
    const server = await this.prisma.minecraftServer.findUnique({
      where: { id: serverId },
      include: { instance: true },
    });

    if (!server) {
      throw new BadRequestException('Server not found');
    }

    // Check if server is running
    if (server.status === 'RUNNING') {
      throw new BadRequestException(
        'Server must be stopped before resetting world',
      );
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
      let deletePaths: string[] = [];

      switch (worldType) {
        case 'overworld':
          deletePaths = [path.posix.join(server.serverPath, 'world')];
          break;
        case 'nether':
          deletePaths = [path.posix.join(server.serverPath, 'world_nether')];
          break;
        case 'end':
          deletePaths = [path.posix.join(server.serverPath, 'world_the_end')];
          break;
        case 'all':
          deletePaths = [
            path.posix.join(server.serverPath, 'world'),
            path.posix.join(server.serverPath, 'world_nether'),
            path.posix.join(server.serverPath, 'world_the_end'),
          ];
          break;
      }

      // Delete world folders
      for (const worldPath of deletePaths) {
        const deleteCommand = `rm -rf "${worldPath}"`;
        await this.sshService.executeCommand(
          instance.id,
          credentials,
          deleteCommand,
        );
      }

      this.logger.log(`World reset completed for server ${serverId}: ${worldType}`);

      return {
        message: `World reset successfully. A new world will be generated on next server start.`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to reset world for server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to reset world');
    }
  }

  /**
   * Upload a custom world (zip file)
   */
  async uploadWorld(
    serverId: string,
    file: Express.Multer.File,
    worldType: 'overworld' | 'nether' | 'end' = 'overworld',
  ): Promise<{ message: string }> {
    if (!file) {
      throw new BadRequestException('No world file provided');
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

    // Check if server is running
    if (server.status === 'RUNNING') {
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
      throw new BadRequestException(
        'Server must be stopped before uploading world',
      );
    }

    // Validate file is a zip
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (fileExt !== '.zip') {
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }
      throw new BadRequestException('World file must be a ZIP archive');
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
      // Determine world folder name
      let worldFolderName: string;
      switch (worldType) {
        case 'overworld':
          worldFolderName = 'world';
          break;
        case 'nether':
          worldFolderName = 'world_nether';
          break;
        case 'end':
          worldFolderName = 'world_the_end';
          break;
      }

      const worldPath = path.posix.join(server.serverPath, worldFolderName);
      const tempZipPath = path.posix.join(server.serverPath, 'world-upload.zip');

      this.logger.log(`Uploading world file to ${tempZipPath}`);

      // Upload zip file
      await this.sshService.uploadFile(
        instance.id,
        credentials,
        file.path,
        tempZipPath,
      );

      // Delete existing world folder
      await this.sshService.executeCommand(
        instance.id,
        credentials,
        `rm -rf "${worldPath}"`,
      );

      // Create world directory
      await this.sshService.executeCommand(
        instance.id,
        credentials,
        `mkdir -p "${worldPath}"`,
      );

      // Extract zip to world folder
      await this.sshService.executeCommand(
        instance.id,
        credentials,
        `cd "${worldPath}" && unzip -o "${tempZipPath}" && rm "${tempZipPath}"`,
      );

      // Clean up local temp file
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        this.logger.warn(`Failed to delete temp file: ${err.message}`);
      }

      this.logger.log(`World uploaded successfully for server ${serverId}`);

      return {
        message: 'World uploaded successfully. Start the server to use the new world.',
      };
    } catch (error) {
      // Clean up on error
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore cleanup errors
      }

      this.logger.error(
        `Failed to upload world for server ${serverId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to upload world');
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
