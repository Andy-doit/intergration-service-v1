import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

import cookieParser from 'cookie-parser';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // ── Global Validation Pipe ───────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      transform: true, // Auto-transform types (e.g. string → number)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── CORS (cho phép Storefront gọi API) ───────────────────────────────────
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // ── Cookie Parser (Cho Đăng nhập Admin) ──────────────────────────────────
  app.use(cookieParser());

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  logger.log(
    `🚀 Order Gateway Service is running at: http://localhost:${port}`,
  );
  logger.log(
    `📊 Bull Board UI available at: http://localhost:${port}/admin/queues`,
  );
}

bootstrap();
