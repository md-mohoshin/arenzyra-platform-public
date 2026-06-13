import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import {
  SuperYoutubeController,
  YoutubeController,
} from './youtube.controller';
import { YoutubeService } from './youtube.service';

@Module({
  imports: [AuthModule],
  controllers: [YoutubeController, SuperYoutubeController],
  providers: [YoutubeService],
  exports: [YoutubeService],
})
export class YoutubeModule {}
