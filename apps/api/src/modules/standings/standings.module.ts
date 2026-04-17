import { Module } from '@nestjs/common';
import { PrismaModule } from '../../db/prisma.module';
import { StandingsController } from './standings.controller';
import { StandingsService } from './standings.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [StandingsController],
  providers: [StandingsService],
  exports: [StandingsService],
})
export class StandingsModule {}
