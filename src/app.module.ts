import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { InstancesModule } from './modules/instances/instances.module';
import { ServersModule } from './modules/servers/servers.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    InstancesModule,
    ServersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
