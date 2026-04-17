import { Controller, Get } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { Public } from '../../common/auth/public.decorator';

@Controller('api/webhooks')
export class WebhookController {
  constructor(private readonly svc: WebhookService) {}

  @Get('status')
  @Public()
  status() {
    return this.svc.status();
  }
}
