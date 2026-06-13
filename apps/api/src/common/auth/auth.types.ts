import type { Role } from '@prisma/client';
import type { Request } from 'express';
import type { Actor } from './jwt.strategy';

export type AuthRole = Role;

// Minimal shared authenticated user model for HTTP contexts.
// Aligns with the full Actor shape returned by JWT validation so it can be
// passed into services that expect an Actor without extra casting.
export type AuthUser = Actor & {
  email?: string | null;
};

export type AuthRequest = Omit<Request, 'user'> & {
  user: AuthUser;
  isSuperAdmin?: boolean;
  isServiceToken?: boolean;
};

// Backwards compatibility alias
export type AuthenticatedRequest = AuthRequest;
