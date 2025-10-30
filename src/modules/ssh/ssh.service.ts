import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client, ConnectConfig } from 'ssh2';

interface SSHConnection {
  client: Client;
  lastUsed: number;
  instanceId: string;
}

interface SSHCredentials {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface PortForwardTunnel {
  localPort: number;
  close: () => void;
}

interface DirectoryCache {
  data: any;
  timestamp: number;
}

interface FileEntry {
  name: string;
  is_directory: boolean;
  permissions: string;
  size?: number;
  modified?: string;
}

@Injectable()
export class SshService implements OnModuleDestroy {
  private readonly logger = new Logger(SshService.name);
  private readonly connections = new Map<string, SSHConnection>();
  private readonly directoryCache = new Map<string, DirectoryCache>();
  private readonly CONNECTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly COMMAND_TIMEOUT = 30000; // 30 seconds
  private readonly CACHE_TTL = 30000; // 30 seconds cache for directory listings

  onModuleDestroy() {
    this.logger.log('Closing all SSH connections...');
    for (const [instanceId, connection] of this.connections.entries()) {
      connection.client.end();
      this.connections.delete(instanceId);
    }
  }

  /**
   * Test SSH connection to verify credentials
   */
  async testConnection(credentials: SSHCredentials): Promise<boolean> {
    const client = new Client();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        client.end();
        resolve(false);
      }, 15000); // 15 second timeout for connection test

      client
        .on('ready', () => {
          clearTimeout(timeout);
          client.end();
          resolve(true);
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          this.logger.error(`Connection test failed: ${err.message}`);
          resolve(false);
        })
        .connect(this.buildConfig(credentials));
    });
  }

  /**
   * Execute a command on the remote instance
   */
  async executeCommand(
    instanceId: string,
    credentials: SSHCredentials,
    command: string,
  ): Promise<CommandResult> {
    const client = await this.getConnection(instanceId, credentials);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        reject(new Error('Command execution timeout'));
      }, this.COMMAND_TIMEOUT);

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          return reject(err);
        }

        stream
          .on('close', (code: number) => {
            clearTimeout(timeout);
            resolve({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode: code,
            });
          })
          .on('data', (data: Buffer) => {
            stdout += data.toString();
          })
          .stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
      });
    });
  }

  /**
   * Get system information from remote instance
   */
  async getSystemInfo(
    instanceId: string,
    credentials: SSHCredentials,
  ): Promise<{
    totalRamMb: number;
    totalCpuCores: number;
    diskSpaceGb: number;
    osType: string;
  }> {
    try {
      // Get RAM in MB
      const ramResult = await this.executeCommand(
        instanceId,
        credentials,
        "free -m | grep Mem | awk '{print $2}'",
      );
      const totalRamMb = parseInt(ramResult.stdout) || 0;

      // Get CPU cores
      const cpuResult = await this.executeCommand(
        instanceId,
        credentials,
        'nproc',
      );
      const totalCpuCores = parseInt(cpuResult.stdout) || 0;

      // Get disk space in GB (root partition)
      const diskResult = await this.executeCommand(
        instanceId,
        credentials,
        "df -BG / | tail -1 | awk '{print $2}' | sed 's/G//'",
      );
      const diskSpaceGb = parseInt(diskResult.stdout) || 0;

      // Get OS type
      const osResult = await this.executeCommand(
        instanceId,
        credentials,
        'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'',
      );
      const osType = osResult.stdout || 'Unknown';

      return {
        totalRamMb,
        totalCpuCores,
        diskSpaceGb,
        osType,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get system info for instance ${instanceId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get or create SSH connection with connection pooling
   */
  private async getConnection(
    instanceId: string,
    credentials: SSHCredentials,
  ): Promise<Client> {
    const now = Date.now();
    const existing = this.connections.get(instanceId);

    // Check if we have a valid cached connection
    if (existing && now - existing.lastUsed < this.CONNECTION_TIMEOUT) {
      // Test if connection is still alive
      try {
        await this.testConnectionHealth(existing.client);
        existing.lastUsed = now;
        this.logger.debug(`Reusing connection for instance ${instanceId}`);
        return existing.client;
      } catch {
        // Connection is dead, remove it
        this.logger.debug(`Stale connection detected for ${instanceId}`);
        existing.client.end();
        this.connections.delete(instanceId);
      }
    }

    // Create new connection
    this.logger.debug(`Creating new connection for instance ${instanceId}`);
    const client = await this.connect(credentials);

    this.connections.set(instanceId, {
      client,
      lastUsed: now,
      instanceId,
    });

    return client;
  }

  /**
   * Test if connection is still alive
   */
  private async testConnectionHealth(client: Client): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Health check timeout'));
      }, 5000);

      client.exec('echo "ping"', (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          return reject(err);
        }

        stream
          .on('close', () => {
            clearTimeout(timeout);
            resolve();
          })
          .on('data', () => {
            // Consume data
          });
      });
    });
  }

  /**
   * Create a new SSH connection
   */
  private async connect(credentials: SSHCredentials): Promise<Client> {
    const client = new Client();
    const config = this.buildConfig(credentials);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('SSH connection timeout'));
      }, 15000);

      client
        .on('ready', () => {
          clearTimeout(timeout);
          this.logger.debug(`SSH connection established to ${credentials.host}`);
          resolve(client);
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          this.logger.error(`SSH connection error: ${err.message}`);
          reject(err);
        })
        .connect(config);
    });
  }

  /**
   * Build SSH connection configuration
   */
  private buildConfig(credentials: SSHCredentials): ConnectConfig {
    const config: ConnectConfig = {
      host: credentials.host,
      port: credentials.port,
      username: credentials.username,
    };

    if (credentials.privateKey) {
      // privateKey is now the actual key content, not a file path
      config.privateKey = credentials.privateKey;
    } else if (credentials.password) {
      config.password = credentials.password;
    } else {
      throw new Error('Either privateKey or password must be provided');
    }

    return config;
  }

  /**
   * Create SSH port forwarding tunnel
   * This allows connecting to a remote port as if it were local
   *
   * @param instanceId - The instance identifier
   * @param credentials - SSH credentials
   * @param remotePort - The port on the remote server to forward
   * @returns Object with local port and close function
   */
  async createPortForward(
    instanceId: string,
    credentials: SSHCredentials,
    remotePort: number,
  ): Promise<PortForwardTunnel> {
    const client = await this.getConnection(instanceId, credentials);

    return new Promise((resolve, reject) => {
      // Use a random available port on localhost
      const net = require('net');
      const server = net.createServer();

      server.listen(0, '127.0.0.1', () => {
        const localPort = server.address().port;
        this.logger.debug(
          `Port forwarding: localhost:${localPort} → ${credentials.host}:${remotePort}`,
        );

        server.on('connection', (socket) => {
          // Forward the connection through SSH to remote localhost:remotePort
          client.forwardOut(
            '127.0.0.1',
            localPort,
            '127.0.0.1', // Connect to localhost on remote (where RCON listens)
            remotePort,
            (err, stream) => {
              if (err) {
                this.logger.error(
                  `Port forward error: ${err.message}`,
                );
                socket.end();
                return;
              }

              // Pipe the socket through the SSH tunnel
              socket.pipe(stream).pipe(socket);

              socket.on('error', (error) => {
                this.logger.error(`Socket error: ${error.message}`);
              });

              stream.on('error', (error) => {
                this.logger.error(`Stream error: ${error.message}`);
              });
            },
          );
        });

        const closeTunnel = () => {
          this.logger.debug(`Closing port forward tunnel on port ${localPort}`);
          server.close();
        };

        resolve({
          localPort,
          close: closeTunnel,
        });
      });

      server.on('error', (err) => {
        this.logger.error(`Failed to create port forward: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * List directory contents with caching
   * Based on Python implementation pattern from directory_navigation.md
   *
   * @param instanceId - The instance identifier
   * @param credentials - SSH credentials
   * @param path - Path to list (relative or absolute)
   * @returns Object with current_path and entries array
   */
  async listDirectory(
    instanceId: string,
    credentials: SSHCredentials,
    path: string,
  ): Promise<{ current_path: string; entries: FileEntry[] }> {
    // Check cache first
    const cacheKey = `${instanceId}:${path}`;
    const cached = this.directoryCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      this.logger.debug(`Cache hit for directory: ${path}`);
      return cached.data;
    }

    // Build command: cd to path, get absolute path, list contents
    let command: string;
    if (path === '~' || path === '' || !path) {
      command = 'pwd && ls -la';
    } else {
      // Single quotes prevent shell injection
      command = `cd '${path}' && pwd && ls -la`;
    }

    try {
      const result = await this.executeCommand(instanceId, credentials, command);

      if (result.exitCode !== 0) {
        throw new Error(`Directory listing failed: ${result.stderr}`);
      }

      // Parse output
      const lines = result.stdout.trim().split('\n');

      // First line is the current path from pwd
      const current_path = lines[0]?.trim() || path;

      // Rest of the lines are from ls -la (skip the "total" line)
      const lsLines = lines.slice(2);

      const entries: FileEntry[] = [];

      for (const line of lsLines) {
        if (!line.trim()) continue;

        // ls -la format: permissions links owner group size month day time name
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;

        const permissions = parts[0];
        const size = parseInt(parts[4], 10) || 0;
        const month = parts[5];
        const day = parts[6];
        const time = parts[7];
        const name = parts.slice(8).join(' '); // Handle spaces in filenames

        // Skip . and .. entries
        if (name === '.' || name === '..') continue;

        const is_directory = permissions.startsWith('d');

        entries.push({
          name,
          is_directory,
          permissions,
          size,
          modified: `${month} ${day} ${time}`,
        });
      }

      const resultData = {
        current_path,
        entries,
      };

      // Cache the result
      this.directoryCache.set(cacheKey, {
        data: resultData,
        timestamp: now,
      });

      this.logger.debug(
        `Listed directory ${path}: ${entries.length} entries`,
      );

      return resultData;
    } catch (error) {
      this.logger.error(`Failed to list directory ${path}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Close connection for a specific instance
   */
  closeConnection(instanceId: string): void {
    const connection = this.connections.get(instanceId);
    if (connection) {
      connection.client.end();
      this.connections.delete(instanceId);
      this.logger.debug(`Closed connection for instance ${instanceId}`);
    }
  }
}
