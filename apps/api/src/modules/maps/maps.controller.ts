import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { MapsService } from './maps.service';

@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get(':mapName/config')
  getConfig(@Param('mapName') mapName: string) {
    const cfg = this.maps.findOne(mapName);
    if (!cfg) throw new NotFoundException('Map not found');
    return cfg;
  }

  @Get('config/:mapName')
  getConfigAlt(@Param('mapName') mapName: string) {
    const cfg = this.maps.findOne(mapName);
    if (!cfg) throw new NotFoundException('Map not found');
    return cfg;
  }
}
