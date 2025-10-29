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
import { InstancesService } from './instances.service';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { UpdateInstanceDto } from './dto/update-instance.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ResponseHelper } from '../../common/helpers/response.helper';

@Controller('instances')
@UseGuards(JwtAuthGuard)
export class InstancesController {
  constructor(private readonly instancesService: InstancesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateInstanceDto) {
    try {
      const instance = await this.instancesService.create(userId, dto);
      return ResponseHelper.success(instance, ['Connection test in progress...']);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }

  @Get()
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
  async getRunningProcesses(@CurrentUser('id') userId: string) {
    try {
      const result = await this.instancesService.getRunningProcesses(userId);
      return ResponseHelper.success(result);
    } catch (error) {
      return ResponseHelper.error([error.message]);
    }
  }
}
