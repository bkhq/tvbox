import fs from 'fs';
import os from 'os';
import path from 'path';

import type { AndroidConfig } from 'expo/config-plugins';

import { copyLauncherResources, setLauncherManifest } from '../withAndroidLauncherAssets';

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'android-res');

function manifest(): AndroidConfig.Manifest.AndroidManifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      application: [
        {
          $: {
            'android:name': '.MainApplication',
            'android:icon': '@mipmap/ic_launcher',
          },
          activity: [
            {
              $: { 'android:name': '.MainActivity' },
              'intent-filter': [
                {
                  action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
                  category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('setLauncherManifest', () => {
  it('sets icon, round icon and banner on the application and the banner on the main activity', () => {
    const out = setLauncherManifest(manifest());
    expect(out.manifest.application?.[0]?.$).toMatchObject({
      'android:name': '.MainApplication',
      'android:icon': '@mipmap/ic_launcher',
      'android:roundIcon': '@mipmap/ic_launcher_round',
      'android:banner': '@mipmap/ic_banner',
    });
    expect(out.manifest.application?.[0]?.activity?.[0]?.$['android:banner']).toBe('@mipmap/ic_banner');
  });

  it('is idempotent', () => {
    const once = JSON.stringify(setLauncherManifest(manifest()));
    expect(JSON.stringify(setLauncherManifest(JSON.parse(once)))).toBe(once);
  });
});

describe('copyLauncherResources', () => {
  let resDir: string;

  beforeEach(() => {
    resDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-res-'));
    fs.mkdirSync(path.join(resDir, 'mipmap-hdpi'));
    fs.writeFileSync(path.join(resDir, 'mipmap-hdpi', 'ic_launcher.webp'), 'template');
  });

  afterEach(() => fs.rmSync(resDir, { recursive: true, force: true }));

  it('replaces the template icon with the Java app assets, repeatably', () => {
    copyLauncherResources(ASSETS_DIR, resDir);
    copyLauncherResources(ASSETS_DIR, resDir);
    expect(fs.existsSync(path.join(resDir, 'mipmap-hdpi', 'ic_launcher.webp'))).toBe(false);
    for (const file of [
      'mipmap-hdpi/ic_launcher.png',
      'mipmap-xxxhdpi/ic_launcher_round.webp',
      'mipmap-anydpi-v26/ic_banner.xml',
      'drawable/ic_banner_foreground.xml',
      'values/launcher_colors.xml',
    ]) {
      expect(fs.existsSync(path.join(resDir, file))).toBe(true);
    }
  });
});
