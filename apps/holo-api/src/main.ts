import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  // Use same mkcert certificates as the display for HTTPS (avoids Mixed Content on mobile)
  // Try multiple paths: relative to __dirname (webpack dist) and relative to cwd (nx serve)
  const possiblePaths = [
    { cert: path.resolve(__dirname, '..', '..', 'holo-display', 'certs', 'cert.pem'),
      key:  path.resolve(__dirname, '..', '..', 'holo-display', 'certs', 'key.pem') },
    { cert: path.resolve(process.cwd(), 'apps', 'holo-display', 'certs', 'cert.pem'),
      key:  path.resolve(process.cwd(), 'apps', 'holo-display', 'certs', 'key.pem') },
  ];
  const found = possiblePaths.find(p => fs.existsSync(p.cert) && fs.existsSync(p.key));
  const certPath = found?.cert || '';
  const keyPath = found?.key || '';
  const hasCerts = !!found;
  if (hasCerts) {
    Logger.log(`SSL certs found at: ${certPath}`);
  }

  let app;
  if (hasCerts) {
    app = await NestFactory.create(AppModule, {
      httpsOptions: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
    });
    Logger.log('HTTPS enabled with mkcert certificates');
  } else {
    app = await NestFactory.create(AppModule);
    Logger.warn('No SSL certs found — running HTTP only (mobile will not connect)');
  }

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST'],
  });

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 3000;
  const proto = hasCerts ? 'https' : 'http';
  await app.listen(port, '0.0.0.0');
  Logger.log(`Application is running on: ${proto}://0.0.0.0:${port}/${globalPrefix}`);
}

bootstrap();
