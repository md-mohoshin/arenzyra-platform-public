import { Module, forwardRef } from '@nestjs/common';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [AuditController],
  providers: [AuditService, OrgScopeGuard],
  exports: [AuditService],
})
export class AuditModule {}
