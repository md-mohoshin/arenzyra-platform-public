import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Actor } from './jwt.strategy';

type SuperGuardRequest = {
  user?: Actor;
  isSuperAdmin?: boolean;
};

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Allow non-http contexts (e.g., gateways) to fall back to their own auth.
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<SuperGuardRequest>();
    const user = req.user;
    const isSuper =
      req.isSuperAdmin ||
      user?.role === Role.SUPER_ADMIN ||
      user?.actorRole === Role.SUPER_ADMIN ||
      user?.actingRole === Role.SUPER_ADMIN;

    if (!user || !isSuper) {
      throw new ForbiddenException('SUPER_ADMIN role required');
    }
    return true;
  }
}
