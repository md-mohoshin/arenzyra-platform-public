import type { AuthUser } from './auth.types';

declare global {
  // Augment Express Request with our Auth Actor so req.user is strongly typed everywhere.
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

export {};
