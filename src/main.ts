import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(';')
    : [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://turismo-9e70c.web.app',
        'https://turismo-9e70c.firebaseapp.com',
      ];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Validação global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Prefixo global
  app.setGlobalPrefix('api');

  // ============ SWAGGER ============
  const config = new DocumentBuilder()
    .setTitle('Turismo API')
    .setDescription('API completa para plataforma de turismo com pagamentos')
    .setVersion('1.0')
    .addTag('services', 'Gerenciamento de serviços de turismo')
    .addTag('orders', 'Pedidos e reservas')
    .addTag('payments', 'Processamento de pagamentos')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT do Firebase Authentication',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  // =================================

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
  console.log(`📚 API disponível em http://localhost:${port}/api`);
  console.log(`📖 Swagger docs em http://localhost:${port}/api/docs`);
}

void bootstrap();
