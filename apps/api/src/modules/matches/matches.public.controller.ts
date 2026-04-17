import { Controller, Get } from '@nestjs/common';
import { LiveState, MatchStatus } from '@prisma/client';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../db/prisma.service';

@Controller('public')
export class MatchesPublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live-match')
  async getLiveMatch(): Promise<{
    matchId: string | null;
    status: MatchStatus | null;
  }> {
    const match = await this.prisma.match.findFirst({
      where: {
        status: MatchStatus.LIVE,
        deletedAt: null,
        endedAt: null,
        liveState: { not: LiveState.ENDED },
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: { id: true, status: true },
    });
    return { matchId: match?.id ?? null, status: match?.status ?? null };
  }
}
