import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  private static shouldBypass(url?: string) {
    if (!url) return false;
    return (
      url.startsWith('/match/live') ||
      url.startsWith('/match/teams') ||
      url.startsWith('/match/players') ||
      url.startsWith('/match/kills') ||
      url.startsWith('/match/circle') ||
      url.startsWith('/match/observer') ||
      url.startsWith('/match/backpack') ||
      url.startsWith('/health') ||
      (url.startsWith('/api/matches/') &&
        (url.includes('/overlay/state') ||
          url.includes('/overlay/teams') ||
          url.includes('/overlay/players') ||
          url.includes('/overlay/map/state')))
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === 'ws') return true;

    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<{ url?: string }>();
    const url = typeof req?.url === 'string' ? req.url : '';

    if (JwtAuthGuard.shouldBypass(url)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const result = await super.canActivate(context);
    return typeof result === 'boolean' ? result : true;
  }

  handleRequest<TUser>(
    err: unknown,
    user: TUser | false | null | undefined,
  ): TUser {
    if (err) {
      if (err instanceof Error) {
        throw err;
      }
      if (typeof err === 'string' && err.trim().length > 0) {
        throw new UnauthorizedException(err);
      }
      throw new UnauthorizedException('Unauthorized');
    }

    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }

    return user;
  }
}
