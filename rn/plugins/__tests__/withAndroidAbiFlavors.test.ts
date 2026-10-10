import { addGeneratedBlock } from '../withAndroidAbiFlavors';

const BASE = 'apply plugin: "com.android.application"\n\nandroid {\n}\n';

describe('addGeneratedBlock', () => {
  it('adds both flavors with their ABI and resValue', () => {
    const out = addGeneratedBlock(BASE);
    expect(out.startsWith(BASE.trimEnd())).toBe(true);
    expect(out).toContain('flavorDimensions = ["abi"]');
    expect(out).toMatch(/arm64_v8a \{[^}]*abiFilters "arm64-v8a"/);
    expect(out).toMatch(/armeabi_v7a \{[^}]*abiFilters "armeabi-v7a"/);
    expect(out).toContain('resValue "string", "tvbox_abi_flavor", "arm64_v8a"');
    expect(out).toContain('resValue "string", "tvbox_abi_flavor", "armeabi_v7a"');
    expect(out).toContain('outputFileName.set("leanback-${abi}.apk")');
  });

  it('is idempotent', () => {
    const once = addGeneratedBlock(BASE);
    expect(addGeneratedBlock(once)).toBe(once);
  });
});
