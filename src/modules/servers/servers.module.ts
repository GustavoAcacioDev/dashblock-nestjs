import { Module } from '@nestjs/common';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { PlanLimitsService } from './services/plan-limits.service';
import { PortAllocationService } from './services/port-allocation.service';
import { ServerMonitorService } from './services/server-monitor.service';
import { RconService } from './services/rcon.service';
import { FileManagementService } from './services/file-management.service';
import { MetricsService } from './services/metrics.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SshModule } from '../ssh/ssh.module';

@Module({
  imports: [PrismaModule, SshModule],
  controllers: [ServersController],
  providers: [
    ServersService,
    PlanLimitsService,
    PortAllocationService,
    ServerMonitorService,
    RconService,
    FileManagementService,
    MetricsService,
  ],
  exports: [
    ServersService,
    PlanLimitsService,
    PortAllocationService,
    ServerMonitorService,
    RconService,
    FileManagementService,
    MetricsService,
  ],
})
export class ServersModule {}
