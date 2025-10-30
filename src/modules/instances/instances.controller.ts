import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InstancesService } from './instances.service';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { UpdateInstanceDto } from './dto/update-instance.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ResponseHelper } from '../../common/helpers/response.helper';

@ApiTags('Remote Instances')
@ApiBearerAuth('JWT-auth')
@Controller('instances')
@UseGuards(JwtAuthGuard)
export class InstancesController {
  constructor(private readonly instancesService: InstancesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a remote instance', description: 'Connect a remote server instance via SSH for hosting Minecraft servers' })
  @ApiResponse({ status: 201, description: 'Instance created successfully. Connection test in progress.' })
  @ApiResponse({ status: 400, description: 'Invalid input or instance already exists' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateInstanceDto) {
    try {
      const instance = await this.instancesService.create(userId, dto);
      return ResponseHelper.success(instance, ['Connection test in progress...']);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get your remote instance', description: 'Retrieve the remote instance configuration for the current user' })
  @ApiResponse({ status: 200, description: 'Returns instance data or null if not configured' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  async findOne(@CurrentUser('id') userId: string) {
    try {
      const instance = await this.instancesService.findByUserId(userId);

      if (!instance) {
        return ResponseHelper.success(null, ['No instance configured yet']);
      }

      return ResponseHelper.success(instance);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  @Put()
  @ApiOperation({ summary: 'Update remote instance', description: 'Update SSH credentials or connection details for your remote instance' })
  @ApiResponse({ status: 200, description: 'Instance updated successfully. Connection test in progress.' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Instance not found' })
  async update(@CurrentUser('id') userId: string, @Body() dto: UpdateInstanceDto) {
    try {
      const instance = await this.instancesService.update(userId, dto);
      return ResponseHelper.success(instance, ['Connection test in progress...']);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete remote instance', description: 'Remove your remote instance configuration' })
  @ApiResponse({ status: 200, description: 'Instance deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Instance not found' })
  async remove(@CurrentUser('id') userId: string) {
    try {
      await this.instancesService.remove(userId);
      return ResponseHelper.success(null);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  @Post('recheck')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recheck instance connection', description: 'Test SSH connection to the remote instance' })
  @ApiResponse({ status: 200, description: 'Connection test initiated' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Instance not found' })
  async recheckConnection(@CurrentUser('id') userId: string) {
    try {
      const instance = await this.instancesService.recheckConnection(userId);
      return ResponseHelper.success(instance, ['Connection test initiated']);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  @Post('kill-all-servers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kill all Minecraft processes', description: 'Force kill all Java/Minecraft server processes on the remote instance' })
  @ApiResponse({ status: 200, description: 'All Minecraft server processes terminated' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Instance not found' })
  async killAllServers(@CurrentUser('id') userId: string) {
    try {
      const result = await this.instancesService.killAllMinecraftServers(userId);
      return ResponseHelper.success(result, [
        'All Minecraft server processes have been terminated',
      ]);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  @Get('processes')
  @ApiOperation({ summary: 'Get running processes', description: 'List all running Java/Minecraft processes on the remote instance' })
  @ApiResponse({ status: 200, description: 'Returns list of running processes' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing JWT token' })
  @ApiResponse({ status: 404, description: 'Instance not found' })
  async getRunningProcesses(@CurrentUser('id') userId: string) {
    try {
      const result = await this.instancesService.getRunningProcesses(userId);
      return ResponseHelper.success(result);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }
}
