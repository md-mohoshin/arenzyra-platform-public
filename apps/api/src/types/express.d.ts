import type { Role } from '@prisma/client';
import type { Actor } from '../common/auth/jwt.strategy';

declare global {
  namespace Express {
    // Extend Express.Request to include our JWT actor and a convenience flag
    // that is populated by SuperAdminMiddleware.

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends Actor {}
    interface Request {
      user?: Actor;
      isSuperAdmin?: boolean;
      role?: Role | null;
      orgId?: string | null;
      organizationId?: string | null;
    }
  }
}

export {};
