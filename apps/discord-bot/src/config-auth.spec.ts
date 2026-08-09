import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProductionApiAuth } from './config';

const valid = {
  nodeEnv: 'production',
  apiServiceToken: 'service-token',
  apiOrganizationId: 'organization-1',
  apiToken: null,
  apiRefreshToken: null,
  apiEmail: null,
  apiPassword: null,
};

test('production Discord API auth requires only scoped service identity', () => {
  assert.doesNotThrow(() => validateProductionApiAuth(valid));
  assert.throws(
    () => validateProductionApiAuth({ ...valid, apiServiceToken: null }),
    /requires ARENZYRA_API_SERVICE_TOKEN/,
  );
  assert.throws(
    () => validateProductionApiAuth({ ...valid, apiOrganizationId: null }),
    /requires ARENZYRA_API_SERVICE_TOKEN/,
  );
  for (const rejected of [
    { apiToken: 'access-token' },
    { apiRefreshToken: 'refresh-token' },
    { apiEmail: 'human@example.com', apiPassword: 'password' },
  ]) {
    assert.throws(
      () => validateProductionApiAuth({ ...valid, ...rejected }),
      /rejects human API credentials/,
    );
  }
});

test('development may use refresh or login auth without changing production policy', () => {
  assert.doesNotThrow(() =>
    validateProductionApiAuth({
      ...valid,
      nodeEnv: 'development',
      apiServiceToken: null,
      apiOrganizationId: null,
      apiRefreshToken: 'refresh-token',
    }),
  );
});
