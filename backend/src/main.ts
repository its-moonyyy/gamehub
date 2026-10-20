import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // All routes live under /api, e.g. GET /api/tasks
  app.setGlobalPrefix('api');

  // Allow the Vite dev server to call the API directly (the frontend also
  // proxies /api, so this is only needed if you call the API from elsewhere).
  // In production set CORS_ORIGIN to the deployed frontend origin(s),
  // comma-separated, e.g. "https://gamehub-web.onrender.com".
  const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins });

  // Strip unknown fields and validate request bodies against the DTOs.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
