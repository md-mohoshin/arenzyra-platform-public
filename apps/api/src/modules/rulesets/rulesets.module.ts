import { Module } from '@nestjs/common';
import { RulesetsController } from './rulesets.controller';
import { RulesetsService } from './rulesets.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RulesetsController],
  providers: [RulesetsService],
  exports: [RulesetsService],
})
export class RulesetsModule {}
