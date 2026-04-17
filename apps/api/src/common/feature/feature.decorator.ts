import { SetMetadata } from '@nestjs/common';
import { FeatureKey } from '@prisma/client';

export const FEATURE_META_KEY = 'required_features';

export const RequireFeatures = (...features: FeatureKey[]) =>
  SetMetadata(FEATURE_META_KEY, features);
