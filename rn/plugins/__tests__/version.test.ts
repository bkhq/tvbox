import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

import { versionFromTag } from '../version';

const CLI = path.join(__dirname, '..', 'version.js');

describe('versionFromTag', () => {
  it.each([
    ['v1.0.5', '1.0.5', 10005],
    ['v2.3.4', '2.3.4', 20304],
    ['v10.99.99', '10.99.99', 109999],
  ])('%s -> %s / %i', (tag, name, code) => {
    expect(versionFromTag(tag)).toEqual({ name, code });
  });

  it.each(['rn-v1.0.5', 'v1.0', 'v1.100.0', 'v1.0.100', '1.0.5', 'v1.0.5-beta', 'v0.0.0', ''])(
    'rejects %p',
    (tag) => {
      expect(() => versionFromTag(tag)).toThrow();
    },
  );
});

describe('version CLI', () => {
  it('prints GITHUB_OUTPUT lines', () => {
    expect(execFileSync(process.execPath, [CLI, 'v1.0.5'], { encoding: 'utf8' })).toBe(
      'code=10005\nname=1.0.5\n',
    );
  });

  it('exits non-zero on a bad tag', () => {
    const result = spawnSync(process.execPath, [CLI, 'rn-v1.0.5'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/rn-v1\.0\.5/);
  });
});
