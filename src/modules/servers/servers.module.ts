import { Module } from '@nestjs/common';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { PlanLimitsService } from './services/plan-limits.service';
import { PortAllocationService } from './services/port-allocation.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SshModule } from '../ssh/ssh.module';

@Module({
  imports: [PrismaModule, SshModule],
  controllers: [ServersController],
  providers: [ServersService, PlanLimitsService, PortAllocationService],
  exports: [ServersService, PlanLimitsService, PortAllocationService],
})
export class ServersModule {}
