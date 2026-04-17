import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { Actor } from './jwt.strategy';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: Actor }>();
    const user = req.user;
    if (!user) return false;
    const candidateRoles = [
      user.role,
      user.actorRole,
      user.actingRole,
      user.realRole,
    ].filter((r): r is Role => Boolean(r));
    return candidateRoles.some((r) => required.includes(r));
  }
}
