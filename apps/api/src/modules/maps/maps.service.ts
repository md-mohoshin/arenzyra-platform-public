import { Injectable } from '@nestjs/common';
import { getMapConfig, MapConfig } from './map.config';

@Injectable()
export class MapsService {
  findOne(mapName: string): MapConfig | null {
    return getMapConfig(mapName);
  }
}
