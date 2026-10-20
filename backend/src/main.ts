import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // All routes live under /api, e.g. GET /api/tasks
  app.setGlobalPrefix('api');

  // Allow the Vite dev server to call the API directly (the frontend also
  // proxies /api, so this is only needed if you call the API from elsewhere).
  app.enableCors({ origin: 'http://localhost:5173' });

  // Strip unknown fields and validate request bodies against the DTOs.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
