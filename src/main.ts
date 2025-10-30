import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Enable response interceptor
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Set global prefix
  app.setGlobalPrefix('api');

  // Swagger/OpenAPI Configuration
  const config = new DocumentBuilder()
    .setTitle('Dashblock API')
    .setDescription(
      'Minecraft Server Management Platform API - Manage multiple Minecraft servers on remote instances with ease',
    )
    .setVersion('1.0')
    .setContact(
      'Dashblock Support',
      'https://github.com/your-repo/dashblock',
      'support@dashblock.com',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth', // This name will be used in @ApiBearerAuth()
    )
    .addTag('Authentication', 'User registration and login endpoints')
    .addTag('Remote Instances', 'Manage remote cloud instances (SSH connections)')
    .addTag('Minecraft Servers', 'Create and manage Minecraft servers')
    .addTag('Plan Limits', 'View subscription plans and usage limits')
    .addServer('http://localhost:3001', 'Development server')
    .addServer('https://api.dashblock.com', 'Production server')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Dashblock API Documentation',
    customfavIcon: 'https://dashblock.com/favicon.ico',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`);
}
bootstrap();
