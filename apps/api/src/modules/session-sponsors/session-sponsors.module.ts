import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { BroadcastModule } from '../broadcast/broadcast.module';
import { SessionSponsorsController } from './session-sponsors.controller';
import { SessionSponsorsService } from './session-sponsors.service';

@Module({
  imports: [AuthModule, BroadcastModule],
  controllers: [SessionSponsorsController],
  providers: [SessionSponsorsService],
})
export class SessionSponsorsModule {}
