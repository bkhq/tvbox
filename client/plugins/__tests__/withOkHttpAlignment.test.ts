import { addGeneratedBlock, OKHTTP_VERSION } from '../withOkHttpAlignment';

const BASE = 'buildscript {\n}\n\nallprojects {\n  repositories {\n  }\n}\n';

describe('addGeneratedBlock', () => {
  it('lifts 3.x/4.x okhttp3 modules to the jarspider version in every configuration', () => {
    const out = addGeneratedBlock(BASE);
    expect(OKHTTP_VERSION).toBe('5.4.0');
    expect(out.startsWith(BASE.trimEnd())).toBe(true);
    expect(out).toMatch(/allprojects \{\s*configurations\.configureEach \{\s*resolutionStrategy\.eachDependency/);
    expect(out).toContain("details.requested.group == 'com.squareup.okhttp3'");
    expect(out).toContain("details.requested.version?.matches('[34]\\\\..*')");
    expect(out).toContain("details.useVersion '5.4.0'");
  });

  it('keeps the jarspider okhttp version in sync', () => {
    const fs = jest.requireActual<typeof import('fs')>('fs');
    const path = jest.requireActual<typeof import('path')>('path');
    const gradle = fs.readFileSync(path.join(__dirname, '../../modules/jarspider/android/build.gradle'), 'utf8');
    expect(gradle).toContain(`api 'com.squareup.okhttp3:okhttp:${OKHTTP_VERSION}'`);
  });

  it('is idempotent', () => {
    const once = addGeneratedBlock(BASE);
    expect(addGeneratedBlock(once)).toBe(once);
    expect(once.split('@generated begin tvbox-okhttp-alignment')).toHaveLength(2);
  });
});
