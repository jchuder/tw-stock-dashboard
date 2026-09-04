import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Web runs on a different origin (dev :5173, preview :4173).
  app.enableCors();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
