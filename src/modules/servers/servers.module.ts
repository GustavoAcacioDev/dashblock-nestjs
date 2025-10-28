import { Module } from '@nestjs/common';
import { ServersController } from './servers.controller';
import { PlanLimitsService } from './services/plan-limits.service';
import { PortAllocationService } from './services/port-allocation.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ServersController],
  providers: [PlanLimitsService, PortAllocationService],
  exports: [PlanLimitsService, PortAllocationService],
})
export class ServersModule {}
