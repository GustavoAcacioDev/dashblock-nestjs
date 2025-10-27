import { Module } from '@nestjs/common';
import { InstancesService } from './instances.service';
import { InstancesController } from './instances.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { SshModule } from '../ssh/ssh.module';

@Module({
  imports: [PrismaModule, SshModule],
  controllers: [InstancesController],
  providers: [InstancesService],
  exports: [InstancesService],
})
export class InstancesModule {}
