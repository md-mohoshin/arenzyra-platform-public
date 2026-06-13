import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { RolesGuard } from './common/auth/roles.guard';
import { Reflector } from '@nestjs/core';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { join } from 'path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ArenzyraWsAdapter } from './common/websocket/arenzyra-ws.adapter';
import {
  buildAllowedCorsOrigins,
  isAllowedCorsOrigin,
} from './common/cors.util';
import { validateEnv } from './config/env.validation';

async function bootstrap() {
  validateEnv();
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const allowedHeaders = [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',
  ];
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

  if (trustProxy) {
    app.set('trust proxy', 1);
  }

  const allowedOrigins = buildAllowedCorsOrigins();

  app.enableCors({
    origin: (origin, callback) => {
      if (!isAllowedCorsOrigin(origin, allowedOrigins)) {
        callback(null, false);
        return;
      }

      callback(null, origin ?? true);
    },
    credentials: false,
    allowedHeaders,
    methods: allowedMethods,
    preflightContinue: true,
  });

  // Explicitly handle OPTIONS for any unmatched routes to satisfy strict browsers.
  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'OPTIONS') {
      const requestOrigin =
        typeof req.headers.origin === 'string' ? req.headers.origin : null;
      if (!isAllowedCorsOrigin(requestOrigin, allowedOrigins)) {
        res.sendStatus(403);
        return;
      }
      if (requestOrigin) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(','));
      res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      res.setHeader('Access-Control-Max-Age', '600');
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Increase body size limits to allow logo uploads (base64) without 413 errors.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const reflector = app.get(Reflector);
  app.useGlobalGuards(new RolesGuard(reflector));

  // Native ws is used for the new low-latency transport paths while
  // existing Socket.IO namespaces are delegated for compatibility.
  app.useWebSocketAdapter(new ArenzyraWsAdapter(app));

  // Serve static broadcast assets (HTML overlays and images)
  const publicPath = join(process.cwd(), 'public');
  app.use(
    express.static(publicPath, {
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'public, max-age=60');
        }
      },
    }),
  );

  // Static assets with cache headers
  const assetsPath = join(process.cwd(), 'public', 'assets');
  app.use(
    '/assets',
    express.static(assetsPath, {
      etag: true,
      lastModified: true,
      maxAge: '1d',
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    }),
  );

  // Serve uploaded files (logos, etc.)
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    maxAge: '1d',
    etag: true,
    lastModified: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  const publicBase =
    process.env.API_PUBLIC_URL ||
    process.env.API_BASE_URL ||
    `http://localhost:${port}`;
  console.log(`API running on ${publicBase}`);
}

void bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
