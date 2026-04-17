import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../../config/env.validation';

const pcobSecret = env.PCOB_SECRET;

@Injectable()
export class PcobSecretGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers['x-pcob-secret'];
    const token =
      typeof header === 'string'
        ? header
        : Array.isArray(header)
          ? (header[0] ?? '')
          : '';

    if (!token || token !== pcobSecret) {
      throw new UnauthorizedException('Invalid PCOB secret');
    }

    return true;
  }
}
