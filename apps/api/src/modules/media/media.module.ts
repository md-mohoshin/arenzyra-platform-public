import { Module } from '@nestjs/common';
import { AssetsPublicController } from './assets.public.controller';
import { MediaController } from './media.controller';
import { MediaPublicController } from './media.public.controller';
import { MediaService } from './media.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AssetsPublicController, MediaController, MediaPublicController],
  providers: [MediaService],
})
export class MediaModule {}
