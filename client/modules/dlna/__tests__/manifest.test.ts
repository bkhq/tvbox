import { readFileSync } from 'fs';
import { join } from 'path';

const MANIFEST = join(__dirname, '..', 'android', 'src', 'main', 'AndroidManifest.xml');

describe('dlna AndroidManifest', () => {
  it('declares WAKE_LOCK, which jUPnP AndroidRouter needs for its WifiLock', () => {
    expect(readFileSync(MANIFEST, 'utf8')).toContain('<uses-permission android:name="android.permission.WAKE_LOCK" />');
  });
});
