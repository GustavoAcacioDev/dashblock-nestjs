import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { InstancesModule } from './modules/instances/instances.module';
import { ServersModule } from './modules/servers/servers.module';
import { EncryptionService } from './common/services/encryption.service';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    // Environment configuration with validation
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: true, // Stop on first error
        allowUnknown: true, // Allow other env variables
      },
    }),
    // Rate limiting to prevent abuse
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10, // 10 requests per second
      },
      {
        name: 'medium',
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
      {
        name: 'long',
        ttl: 900000, // 15 minutes
        limit: 500, // 500 requests per 15 minutes
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    InstancesModule,
    ServersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    EncryptionService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  exports: [EncryptionService],
})
export class AppModule {}
