import { describe, expect, it } from 'vitest';
import config from '../wxt.config';

type ManifestFn = (env: {
  mode: string;
  browser: string;
  manifestVersion: 3;
  command: string;
}) => Record<string, unknown>;

const manifestFor = (mode: string) =>
  (config.manifest as ManifestFn)({
    mode,
    browser: 'chrome',
    manifestVersion: 3,
    command: 'build',
  });

describe('manifest config', () => {
  it('requests exactly the permissions the spec allows', () => {
    const m = manifestFor('production');
    expect([...(m.permissions as string[])].sort()).toEqual(['identity', 'storage']);
    expect([...(m.host_permissions as string[])].sort()).toEqual([
      'https://login.microsoftonline.com/*',
      'https://management.azure.com/*',
      'https://portal.azure.com/*',
    ]);
  });

  it('pins the dev extension ID only in development builds', () => {
    expect(manifestFor('production')).not.toHaveProperty('key');
    expect(manifestFor('development')).toHaveProperty('key');
  });

  it('declares no optional or externally reachable access', () => {
    const m = manifestFor('production');
    for (const key of [
      'optional_permissions',
      'optional_host_permissions',
      'web_accessible_resources',
      'externally_connectable',
    ]) {
      expect(m).not.toHaveProperty(key);
    }
  });
});
