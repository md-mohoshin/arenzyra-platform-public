import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { OrganizerAccessMode, Role } from '@prisma/client';
import type { AuthRequest } from './auth.types';

@Injectable()
export class OrganizerAccessModeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const user = req.user;
    if (!user) return true;

    const effectiveRole = user.actingRole ?? user.role;
    if (effectiveRole !== Role.ADMIN && effectiveRole !== Role.ORGANIZER) {
      return true;
    }

    const accessMode =
      user.accessMode ??
      (user.organizerAccessMode === OrganizerAccessMode.DISCORD_ONLY ||
      user.organizationAccessMode === OrganizerAccessMode.DISCORD_ONLY
        ? OrganizerAccessMode.DISCORD_ONLY
        : OrganizerAccessMode.FULL_PRODUCTION);

    if (accessMode !== OrganizerAccessMode.DISCORD_ONLY) {
      return true;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const path = this.normalizePath(req.path || req.url || '');
    if (this.isAllowedDiscordOnlyPath(method, path, req.body)) {
      return true;
    }

    throw new ForbiddenException(
      'This organizer account is limited to Discord management.',
    );
  }

  private normalizePath(input: string): string {
    const [path] = input.split('?');
    return path.replace(/^\/api(?=\/)/, '') || '/';
  }

  private isAllowedDiscordOnlyPath(
    method: string,
    path: string,
    body?: unknown,
  ): boolean {
    if (path === '/auth/me' || path === '/auth/logout') return true;
    if (path === '/admin/impersonate-exit') return true;
    if (path === '/super/impersonate/exit') return true;
    if (this.isDiscordOnlyClientPortalPath(method, path)) return true;
    if (this.isDiscordOnlyBrandingPath(method, path)) return true;
    if (this.isDiscordOnlyUploadPath(method, path)) return true;
    if (path === '/organizer/discord-config') return true;
    if (path.startsWith('/organizer/discord-config/')) return true;
    if (method === 'GET' && path === '/organizer/teams') return true;
    if (path === '/organizer/team-bans') return true;
    if (
      method === 'POST' &&
      /^\/organizer\/team-bans\/[^/]+\/revoke$/.test(path)
    ) {
      return true;
    }
    if (method === 'POST' && path === '/organizer/teams/register-discord') {
      return true;
    }
    if (
      method === 'POST' &&
      /^\/organizer\/teams\/[^/]+\/discord-cleanup$/.test(path)
    ) {
      return true;
    }
    if (method === 'POST' && /^\/organizer\/teams\/[^/]+\/logo$/.test(path)) {
      return true;
    }
    if (method === 'GET' && /^\/organizer\/teams\/[^/]+\/members$/.test(path)) {
      return true;
    }
    if (method === 'GET' && path.startsWith('/organizer/teams/by-tag/')) {
      return true;
    }
    if (method === 'GET' && path === '/sessions') return true;
    if (method === 'GET' && path === '/sessions/discord/resolve-channel') {
      return true;
    }
    if (method === 'GET' && /^\/sessions\/[^/]+$/.test(path)) return true;
    if (
      method === 'POST' &&
      path === '/sessions' &&
      this.isDiscordOnlySessionCreate(body)
    ) {
      return true;
    }
    if (
      method === 'PATCH' &&
      /^\/sessions\/[^/]+$/.test(path) &&
      this.isDiscordOnlySessionPatch(body)
    ) {
      return true;
    }
    if (method === 'POST' && /^\/sessions\/[^/]+\/archive$/.test(path)) {
      return true;
    }
    if (method === 'DELETE' && /^\/sessions\/[^/]+$/.test(path)) {
      return true;
    }
    if (method === 'GET' && /^\/sessions\/[^/]+\/registrations$/.test(path)) {
      return true;
    }
    if (method === 'POST' && /^\/sessions\/[^/]+\/register-team$/.test(path)) {
      return true;
    }
    if (
      method === 'DELETE' &&
      /^\/sessions\/[^/]+\/registrations\/slots$/.test(path)
    ) {
      return true;
    }
    if (
      method === 'DELETE' &&
      /^\/sessions\/[^/]+\/registrations\/[^/]+$/.test(path)
    ) {
      return true;
    }
    if (
      method === 'PATCH' &&
      /^\/sessions\/[^/]+\/registrations\/[^/]+$/.test(path)
    ) {
      return true;
    }
    if (
      method === 'PATCH' &&
      /^\/sessions\/[^/]+\/registrations\/[^/]+\/play-status$/.test(path)
    ) {
      return true;
    }
    if (/^\/sessions\/[^/]+\/discord-config$/.test(path)) return true;
    if (method === 'POST' && /^\/sessions\/[^/]+\/discord-sync$/.test(path)) {
      return true;
    }
    if (
      method === 'POST' &&
      /^\/sessions\/[^/]+\/discord-logo-history-sync$/.test(path)
    ) {
      return true;
    }
    if (method === 'GET' && /^\/sessions\/[^/]+\/standings$/.test(path)) {
      return true;
    }
    if (method === 'GET' && /^\/sessions\/[^/]+\/matches$/.test(path)) {
      return true;
    }
    if (method === 'POST' && /^\/sessions\/[^/]+\/matches$/.test(path)) {
      return true;
    }
    if (
      method === 'POST' &&
      /^\/sessions\/[^/]+\/matches\/[^/]+\/sync-slots$/.test(path)
    ) {
      return true;
    }
    if (method === 'GET' && /^\/me\/matches\/[^/]+\/slots$/.test(path)) {
      return true;
    }
    if (method === 'POST' && path === '/ingest/screenshot') return true;
    if (method === 'POST' && path === '/ingest/screenshot/slot-map') {
      return true;
    }
    if (method === 'POST' && path === '/ingest/screenshot/apply') return true;
    if (
      method === 'GET' &&
      /^\/render\/match\/[^/]+(?:\/discord(?:\/[^/]+)?)?$/.test(path)
    ) {
      return true;
    }
    return false;
  }

  private isDiscordOnlyClientPortalPath(method: string, path: string): boolean {
    if (method === 'GET' && path === '/organizer/client-portal') return true;
    if (
      method === 'POST' &&
      /^\/organizer\/client-portal\/(?:support-request|payment-proof)$/.test(
        path,
      )
    ) {
      return true;
    }

    return false;
  }

  private isDiscordOnlyUploadPath(method: string, path: string): boolean {
    if (method !== 'POST') return false;

    if (path === '/media/upload') return true;
    if (
      /^\/uploads\/(?:sponsor-logo|tournament-logo|tournament-banner|event-logo|event-banner)$/.test(
        path,
      )
    ) {
      return true;
    }
    if (path === '/ingest/screenshot/upload') return true;
    if (/^\/tournaments\/[^/]+\/logo$/.test(path)) return true;
    if (/^\/organizer\/teams\/[^/]+\/logo$/.test(path)) return true;
    if (/^\/organizer\/players\/[^/]+\/photo$/.test(path)) return true;
    if (/^\/me\/teams\/[^/]+\/logo(?:-light|-dark)?$/.test(path)) return true;
    if (/^\/org\/[^/]+\/teams\/[^/]+\/logo(?:-light|-dark)?$/.test(path)) {
      return true;
    }
    if (/^\/org\/[^/]+\/players\/[^/]+\/photo$/.test(path)) return true;

    return false;
  }

  private isDiscordOnlyBrandingPath(method: string, path: string): boolean {
    if (!['GET', 'PUT', 'PATCH'].includes(method)) return false;
    return /^\/branding\/[^/]+$/.test(path);
  }

  private isDiscordOnlySessionCreate(body: unknown): boolean {
    if (!this.isRecord(body)) return false;
    return body.type === 'SCRIM';
  }

  private isDiscordOnlySessionPatch(body: unknown): boolean {
    if (!this.isRecord(body)) return false;
    const keys = Object.keys(body);
    if (keys.length === 0) return false;
    return keys.every((key) => {
      const value = body[key];
      if (key === 'registrationOpenAt' || key === 'registrationCloseAt') {
        return value === null;
      }
      if (key === 'name') {
        return typeof value === 'string' && value.trim().length > 0;
      }
      if (key === 'status') {
        return (
          typeof value === 'string' &&
          [
            'DRAFT',
            'OPEN',
            'CHECKIN',
            'LOCKED',
            'LIVE',
            'ENDED',
            'ARCHIVED',
          ].includes(value)
        );
      }
      if (key === 'slotCount' || key === 'maxTeams') {
        return (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 1 &&
          value <= 100
        );
      }
      return false;
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }
}
