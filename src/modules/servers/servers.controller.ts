import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ServersService } from './servers.service';
import { PlanLimitsService } from './services/plan-limits.service';
import { RconService } from './services/rcon.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { ResponseHelper } from '../../common/helpers/response.helper';

@Controller('servers')
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(
    private readonly serversService: ServersService,
    private readonly planLimitsService: PlanLimitsService,
    private readonly rconService: RconService,
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
  @Post(':id/command')
  async executeCommand(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body('command') command: string,
  ) {
    try {
      // Verify ownership
      await this.serversService.findOne(userId, id);

      const result = await this.rconService.executeCommand(id, command);
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
}
