import 'dotenv/config';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../../config/env.validation';

const collectorSecret = env.COLLECTOR_SECRET;

@Injectable()
export class CollectorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const headers = req.headers || {};

    const authHeader =
      typeof headers.authorization === 'string'
        ? headers.authorization
        : typeof (headers as Record<string, unknown>).Authorization === 'string'
          ? (headers as Record<string, string>).Authorization
          : '';
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : '';

    const collectorHeaderRaw = headers['x-collector-secret'];
    const headerToken =
      typeof collectorHeaderRaw === 'string'
        ? collectorHeaderRaw
        : Array.isArray(collectorHeaderRaw)
          ? (collectorHeaderRaw[0] ?? '')
          : '';

    const token = bearerToken || headerToken;
    if (!token || token !== collectorSecret) {
      throw new UnauthorizedException('Invalid collector token');
    }
    return true;
  }
}
