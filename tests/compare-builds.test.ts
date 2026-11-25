import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareBuilds } from '../scripts/compare-builds.mjs';

const dirs: string[] = [];
function folder(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'azinfo-compare-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const MANIFEST = JSON.stringify({ name: 'azinfo', version: '0.2.0', permissions: ['identity'] });

describe('compareBuilds', () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('ignores what the stores add: _metadata, update_url and key', () => {
    const release = folder({ 'manifest.json': MANIFEST, 'background.js': 'a' });
    const installed = folder({
      'manifest.json': JSON.stringify({
        update_url: 'https://clients2.google.com/service/update2/crx',
        key: 'MIIB...',
        permissions: ['identity'],
        version: '0.2.0',
        name: 'azinfo',
      }),
      'background.js': 'a',
      '_metadata/verified_contents.json': '{}',
    });
    expect(compareBuilds(release, installed)).toEqual({
      compared: 2,
      onlyInRelease: [],
      onlyInstalled: [],
      different: [],
    });
  });

  it('reports changed, missing and extra files, and a changed permission', () => {
    const release = folder({ 'manifest.json': MANIFEST, 'a.js': 'a', 'b.js': 'b' });
    const installed = folder({
      'manifest.json': JSON.stringify({
        name: 'azinfo',
        version: '0.2.0',
        permissions: ['identity', 'tabs'],
      }),
      'a.js': 'changed',
      'extra.js': 'x',
    });
    expect(compareBuilds(release, installed)).toEqual({
      compared: 3,
      onlyInRelease: ['b.js'],
      onlyInstalled: ['extra.js'],
      different: ['a.js', 'manifest.json'],
    });
  });
});
