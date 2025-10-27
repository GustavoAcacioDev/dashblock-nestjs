import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { InstancesModule } from './modules/instances/instances.module';

@Module({
  imports: [PrismaModule, AuthModule, InstancesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
