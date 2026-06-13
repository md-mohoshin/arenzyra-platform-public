import { Module } from '@nestjs/common';
import { AiCasterController } from './ai-caster.controller';
import { AiCasterService } from './ai-caster.service';

@Module({
  controllers: [AiCasterController],
  providers: [AiCasterService],
  exports: [AiCasterService],
})
export class AiCasterModule {}
