/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { serveAsset, webAssets } from '../web';

const webDir = join(__dirname, '..', '..', '..', 'assets', 'web');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('web assets', () => {
  it('serves index.html for the root', () => {
    const res = serveAsset('/');
    expect(res).toMatchObject({ status: 200, bodyEncoding: 'base64', headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const html = Buffer.from(res.body ?? '', 'base64').toString('utf8');
    expect(html).toContain('<html');
    for (const tab of ['remote', 'search', 'library', 'more']) expect(html).toContain(`data-tab="${tab}"`);
    expect(html).not.toContain('jquery');
  });

  it.each([
    ['/css/ui.css', 'text/css; charset=utf-8'],
    ['/js/script.js', 'application/javascript; charset=utf-8'],
    ['/favicon.ico', 'image/x-icon'],
  ])('serves %s as %s', (path, mime) => {
    expect(serveAsset(path)).toMatchObject({ status: 200, headers: { 'Content-Type': mime } });
  });

  it('returns 404 for unknown paths', () => {
    expect(serveAsset('/nope.html').status).toBe(404);
    expect(serveAsset('/toString').status).toBe(404);
    expect(serveAsset('/../index.html').status).toBe(404);
  });

  it('is in sync with assets/web (run `npm run gen:lan-web`)', () => {
    const files = walk(webDir);
    const expected = Object.fromEntries(
      files.map((file) => [relative(webDir, file).split(sep).join('/'), readFileSync(file).toString('base64')]),
    );
    const actual = Object.fromEntries(Object.entries(webAssets).map(([path, asset]) => [path, asset.base64]));
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [path, base64] of Object.entries(expected)) expect(actual[path] === base64 ? path : `${path} is stale`).toBe(path);
  });
});
