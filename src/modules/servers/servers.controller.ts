import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  UseGuards,
  Query,
  UseInterceptors,
  UploadedFile,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ServersService } from './servers.service';
import { PlanLimitsService } from './services/plan-limits.service';
import { RconService } from './services/rcon.service';
import { ServerMonitorService } from './services/server-monitor.service';
import { FileManagementService } from './services/file-management.service';
import { MetricsService } from './services/metrics.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { ExecuteCommandDto } from './dto/execute-command.dto';
import { FileBrowserResponseDto } from './dto/file-entry.dto';
import { ResponseHelper } from '../../common/helpers/response.helper';

@ApiTags('Minecraft Servers')
@ApiBearerAuth('JWT-auth')
@Controller('servers')
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(
    private readonly serversService: ServersService,
    private readonly planLimitsService: PlanLimitsService,
    private readonly rconService: RconService,
    private readonly serverMonitorService: ServerMonitorService,
    private readonly fileManagementService: FileManagementService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Get user's plan limits and current usage
   * GET /servers/limits
   */
  @Get('limits')
  async getLimits(@CurrentUser('id') userId: string) {
    try {
      const limits = await this.planLimitsService.getUserLimits(userId);
      return ResponseHelper.success(limits);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Get all available plans and their limits
   * GET /servers/plans
   */
  @Get('plans')
  async getPlans() {
    try {
      const plans = this.planLimitsService.getAllPlanConfigs();
      return ResponseHelper.success(plans);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Create a new Minecraft server
   * POST /servers
   */
  @Throttle({ short: { limit: 3, ttl: 60000 } }) // 3 servers per minute
  @ApiOperation({
    summary: 'Create a new Minecraft server',
    description: 'Creates a new Minecraft server on your remote instance. The server JAR will be downloaded, systemd service created, and server configured automatically. This process runs in the background.',
  })
  @ApiBody({ type: CreateServerDto })
  @ApiResponse({
    status: 201,
    description: 'Server created successfully. Setup running in background.',
    schema: {
      example: {
        isSuccess: true,
        value: {
          id: 'cm123abc',
          name: 'My Survival Server',
          version: '1.20.1',
          type: 'PAPER',
          status: 'STOPPED',
          gamePort: 25565,
          rconPort: 25665,
          allocatedRamMb: 2048,
          maxPlayers: 20,
        },
        messages: ['Server created successfully. Setup in progress...'],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or plan limit reached',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing JWT token',
  })
  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() createServerDto: CreateServerDto,
  ) {
    try {
      const server = await this.serversService.create(userId, createServerDto);
      return ResponseHelper.success(server, [
        'Server created successfully. Setup in progress...',
      ]);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Get all servers for the current user
   * GET /servers
   */
  @Get()
  async findAll(@CurrentUser('id') userId: string) {
    try {
      const servers = await this.serversService.findAll(userId);
      return ResponseHelper.success(servers);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Get a specific server
   * GET /servers/:id
   */
  @Get(':id')
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    try {
      const server = await this.serversService.findOne(userId, id);
      return ResponseHelper.success(server);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Start a server
   * POST /servers/:id/start
   */
  @Post(':id/start')
  async start(@CurrentUser('id') userId: string, @Param('id') id: string) {
    try {
      const server = await this.serversService.start(userId, id);
      return ResponseHelper.success(server, ['Server starting...']);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Stop a server
   * POST /servers/:id/stop
   */
  @Post(':id/stop')
  async stop(@CurrentUser('id') userId: string, @Param('id') id: string) {
    try {
      const server = await this.serversService.stop(userId, id);
      return ResponseHelper.success(server, ['Server stopping...']);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Update server configuration
   * PATCH /servers/:id
   */
  @Patch(':id')
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() updateServerDto: UpdateServerDto,
  ) {
    try {
      const server = await this.serversService.update(
        userId,
        id,
        updateServerDto,
      );
      return ResponseHelper.success(server, ['Server updated successfully']);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Delete a server
   * DELETE /servers/:id
   */
  @Delete(':id')
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    try {
      await this.serversService.remove(userId, id);
      return ResponseHelper.success(null, [
        'Server deleted successfully. Cleanup in progress...',
      ]);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Get server logs and debug info
   * GET /servers/:id/logs
   */
  @Get(':id/logs')
  async getLogs(@CurrentUser('id') userId: string, @Param('id') id: string) {
    try {
      const logs = await this.serversService.getServerLogs(userId, id);
      return ResponseHelper.success(logs);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Execute RCON command on a server
   * POST /servers/:id/command
   */
  @Throttle({ short: { limit: 20, ttl: 60000 } }) // 20 commands per minute
  @Post(':id/command')
  @ApiOperation({
    summary: 'Execute RCON command',
    description: 'Execute a Minecraft server command via RCON. The server must be running.',
  })
  @ApiBody({ type: ExecuteCommandDto })
  @ApiResponse({
    status: 200,
    description: 'Command executed successfully',
    schema: {
      example: {
        isSuccess: true,
        value: {
          response: 'There are 2 of a max of 20 players online: Player1, Player2',
        },
        messages: [],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Server is not running or command failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async executeCommand(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ExecuteCommandDto,
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      const result = await this.rconService.executeCommand(id, dto.command);
      return ResponseHelper.success(result);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Get current players on a server
   * GET /servers/:id/players
   */
  @Get(':id/players')
  async getPlayers(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      const players = await this.rconService.getPlayers(id);
      return ResponseHelper.success(players);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Get server console logs (last 100 lines)
   * GET /servers/:id/console
   */
  @Get(':id/console')
  async getConsole(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('lines') lines?: string,
  ) {
    try {
      const lineCount = lines ? parseInt(lines, 10) : 100;
      const console = await this.serversService.getConsole(userId, id, lineCount);
      return ResponseHelper.success(console);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Refresh server status
   * POST /servers/:id/refresh-status
   */
  @Post(':id/refresh-status')
  @ApiOperation({
    summary: 'Refresh server status',
    description: 'Manually check and update the current status of the server from systemd'
  })
  @ApiResponse({ status: 200, description: 'Server status refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async refreshStatus(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Trigger status check
      await this.serverMonitorService.checkSpecificServer(id);

      // Return updated server
      const server = await this.serversService.findOne(userId, id);
      return ResponseHelper.success(server, ['Server status refreshed']);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Browse server files and directories
   * GET /servers/:id/files/browse
   */
  @Get(':id/files/browse')
  @ApiOperation({
    summary: 'Browse server files',
    description: 'List files and directories in the server. Navigate through mods, plugins, config, world, etc.',
  })
  @ApiResponse({
    status: 200,
    description: 'Directory listing retrieved successfully',
    type: FileBrowserResponseDto,
    schema: {
      example: {
        isSuccess: true,
        value: {
          current_path: '/home/opc/minecraft/mc-server-xxxx/mods',
          entries: [
            {
              name: 'MyMod-1.0.jar',
              is_directory: false,
              permissions: '-rw-r--r--',
              size: 1048576,
              modified: 'Oct 29 12:00',
            },
            {
              name: 'config',
              is_directory: true,
              permissions: 'drwxr-xr-x',
              size: 4096,
              modified: 'Oct 29 11:00',
            },
          ],
        },
        messages: [],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid path or access denied' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async browseFiles(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('path') path: string = '.',
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Browse files
      const result = await this.fileManagementService.browseServerFiles(id, path);
      return ResponseHelper.success(result);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Upload a file to the server
   * POST /servers/:id/files/upload
   */
  @Throttle({ short: { limit: 10, ttl: 60000 } }) // 10 uploads per minute
  @Post(':id/files/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, uniqueSuffix + '-' + file.originalname);
        },
      }),
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload file to server',
    description: 'Upload mods, plugins, configs, or other files to the server. Max file size: 100MB.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'File uploaded successfully',
    schema: {
      example: {
        isSuccess: true,
        value: {
          message: 'File uploaded successfully',
          path: '/home/opc/minecraft/mc-server-xxxx/mods/MyMod-1.0.jar',
        },
        messages: ['File uploaded successfully'],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid file or access denied' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async uploadFile(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('path') destinationPath: string = '.',
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Upload file
      const result = await this.fileManagementService.uploadFile(
        id,
        file,
        destinationPath,
      );
      return ResponseHelper.success(result, [result.message]);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Download a file from the server
   * GET /servers/:id/files/download
   */
  @Throttle({ short: { limit: 10, ttl: 60000 } }) // 10 downloads per minute
  @Get(':id/files/download')
  @ApiOperation({
    summary: 'Download file from server',
    description: 'Download a file from the server (configs, mods, logs, etc.).',
  })
  @ApiResponse({
    status: 200,
    description: 'File downloaded successfully',
    content: {
      'application/octet-stream': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid path or access denied' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server or file not found' })
  async downloadFile(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('path') filePath: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    let cleanup: (() => void) | undefined;

    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Download file
      const result = await this.fileManagementService.downloadFile(id, filePath);
      cleanup = result.cleanup;

      // Set response headers
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      });

      // Read file and stream it
      const fs = require('fs');
      const fileStream = fs.createReadStream(result.localPath);

      // Clean up after streaming completes
      fileStream.on('end', () => {
        if (cleanup) cleanup();
      });

      fileStream.on('error', () => {
        if (cleanup) cleanup();
      });

      return new StreamableFile(fileStream);
    } catch (error) {
      // Clean up on error
      if (cleanup) cleanup();
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Read file content for editing
   * GET /servers/:id/files/content
   */
  @Get(':id/files/content')
  @ApiOperation({
    summary: 'Read file content',
    description: 'Read the content of a text-based file for editing (configs, logs, etc.).',
  })
  @ApiResponse({
    status: 200,
    description: 'File content retrieved successfully',
    schema: {
      example: {
        isSuccess: true,
        value: {
          content: 'server-port=25565\nmax-players=20',
          filename: 'server.properties',
        },
        messages: [],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid path or file type not editable' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server or file not found' })
  async readFileContent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('path') filePath: string,
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Read file content
      const result = await this.fileManagementService.readFileContent(id, filePath);
      return ResponseHelper.success(result);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Write file content (save edits)
   * PUT /servers/:id/files/content
   */
  @Throttle({ short: { limit: 20, ttl: 60000 } }) // 20 saves per minute
  @Put(':id/files/content')
  @ApiOperation({
    summary: 'Save file content',
    description: 'Save edited content to a text-based file (configs, etc.).',
  })
  @ApiResponse({
    status: 200,
    description: 'File saved successfully',
    schema: {
      example: {
        isSuccess: true,
        value: {
          message: 'File saved successfully',
        },
        messages: ['File saved successfully'],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid path or file type not editable' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server or file not found' })
  async writeFileContent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { path: string; content: string },
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Validate body
      if (!body.path || body.content === undefined) {
        return ResponseHelper.error(['Path and content are required']);
      }

      // Write file content
      const result = await this.fileManagementService.writeFileContent(
        id,
        body.path,
        body.content,
      );
      return ResponseHelper.success(result, [result.message]);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Delete a file from the server
   * DELETE /servers/:id/files
   */
  @Throttle({ short: { limit: 15, ttl: 60000 } }) // 15 deletions per minute
  @Delete(':id/files')
  @ApiOperation({
    summary: 'Delete file from server',
    description: 'Delete a file or directory from the server.',
  })
  @ApiResponse({
    status: 200,
    description: 'File deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid path or access denied' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server or file not found' })
  async deleteFile(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('path') filePath: string,
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Delete file
      const result = await this.fileManagementService.deleteFile(id, filePath);
      return ResponseHelper.success(result, [result.message]);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Get server performance metrics
   * GET /servers/:id/metrics
   */
  @Get(':id/metrics')
  @ApiOperation({
    summary: 'Get server performance metrics',
    description: 'Get CPU, memory, disk usage, and player count for a specific server.',
  })
  @ApiResponse({
    status: 200,
    description: 'Server metrics retrieved successfully',
    schema: {
      example: {
        isSuccess: true,
        value: {
          cpuUsage: 45.2,
          memoryUsedMb: 2048,
          memoryAllocatedMb: 4096,
          memoryUsagePercent: 50,
          diskUsedGb: 2.5,
          diskTotalGb: 50,
          diskUsagePercent: 5,
          uptimeSeconds: 3600,
          activePlayers: 5,
          maxPlayers: 20,
        },
        messages: [],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async getServerMetrics(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Get metrics
      const metrics = await this.metricsService.getServerMetrics(id);
      return ResponseHelper.success(metrics);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Reset server world
   * POST /servers/:id/world/reset
   */
  @Throttle({ short: { limit: 3, ttl: 300000 } }) // 3 resets per 5 minutes
  @Post(':id/world/reset')
  @ApiOperation({
    summary: 'Reset server world',
    description: 'Delete world folders to generate a fresh world. Server must be stopped.',
  })
  @ApiResponse({
    status: 200,
    description: 'World reset successfully',
    schema: {
      example: {
        isSuccess: true,
        value: {
          message: 'World reset successfully. A new world will be generated on next server start.',
        },
        messages: ['World reset successfully. A new world will be generated on next server start.'],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Server is running or invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async resetWorld(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('type') worldType: 'overworld' | 'nether' | 'end' | 'all' = 'all',
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Reset world
      const result = await this.fileManagementService.resetWorld(id, worldType);
      return ResponseHelper.success(result, [result.message]);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  /**
   * Upload custom world
   * POST /servers/:id/world/upload
   */
  @Throttle({ short: { limit: 3, ttl: 300000 } }) // 3 uploads per 5 minutes
  @Post(':id/world/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, uniqueSuffix + '-' + file.originalname);
        },
      }),
      limits: {
        fileSize: 500 * 1024 * 1024, // 500MB for world files
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
          cb(null, true);
        } else {
          cb(new Error('Only ZIP files are allowed'), false);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload custom world',
    description: 'Upload a custom world as a ZIP file. Server must be stopped. Max file size: 500MB.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'World uploaded successfully',
    schema: {
      example: {
        isSuccess: true,
        value: {
          message: 'World uploaded successfully. Start the server to use the new world.',
        },
        messages: ['World uploaded successfully. Start the server to use the new world.'],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Server is running, invalid file, or upload failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async uploadWorld(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('type') worldType: 'overworld' | 'nether' | 'end' = 'overworld',
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      // Upload world
      const result = await this.fileManagementService.uploadWorld(id, file, worldType);
      return ResponseHelper.success(result, [result.message]);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }
}
