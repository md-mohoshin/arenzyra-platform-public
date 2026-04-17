import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Observable } from 'rxjs';
import type { Actor } from '../auth/jwt.strategy';
import { effectiveOrganizationId } from './org.util';
import { OrgScopeService } from './org-scope.service';

@Injectable()
export class OrgScopeInterceptor implements NestInterceptor {
  constructor(private readonly orgScope: OrgScopeService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{
      user?: Actor;
      orgId?: string | null;
      organizationId?: string | null;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const actor = req.user;
    const role = actor?.actorRole ?? actor?.role ?? null;
    const actorId = actor?.actorId ?? actor?.id ?? null;
    const baseOrg = actor ? effectiveOrganizationId(actor) : null;
    const headerOrg =
      typeof req.headers['x-organization-id'] === 'string'
        ? req.headers['x-organization-id']
        : Array.isArray(req.headers['x-organization-id'])
          ? req.headers['x-organization-id'][0]
          : null;

    // Skip unauthenticated routes (e.g., /auth/login or public endpoints)
    if (!req.user) {
      return next.handle();
    }

    if (role !== Role.SUPER_ADMIN) {
      const effectiveOrg = baseOrg;
      if (!effectiveOrg) {
        throw new ForbiddenException('organizationId is required');
      }
      req.orgId = effectiveOrg;
      req.organizationId = effectiveOrg;
      return this.orgScope.runWithOrg(effectiveOrg, actorId, role, () =>
        next.handle(),
      );
    }

    // SUPER_ADMIN: allow override via header, otherwise keep user orgId/null.
    const effectiveOrg = headerOrg ?? baseOrg ?? null;
    req.orgId = effectiveOrg;
    req.organizationId = effectiveOrg;
    return this.orgScope.runWithOrg(effectiveOrg, actorId, role, () =>
      next.handle(),
    );
  }
}
