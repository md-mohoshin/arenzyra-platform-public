import { Injectable, NestMiddleware } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';
import type { Actor } from './jwt.strategy';

type SuperAdminRequest = Request & {
  user?: Actor;
  isSuperAdmin?: boolean;
};

@Injectable()
export class SuperAdminMiddleware implements NestMiddleware {
  use(req: SuperAdminRequest, _res: Response, next: NextFunction) {
    // Define a lazy getter so the value reflects the user injected by JwtAuthGuard.
    if (!Object.getOwnPropertyDescriptor(req, 'isSuperAdmin')) {
      Object.defineProperty(req, 'isSuperAdmin', {
        configurable: true,
        enumerable: true,
        get() {
          return (req.user?.role ?? null) === Role.SUPER_ADMIN;
        },
        set(value: boolean) {
          Object.defineProperty(req, 'isSuperAdmin', {
            value,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        },
      });
    } else if (req.user) {
      req.isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
    }

    next();
  }
}
