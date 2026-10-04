import { chooseEngine, defaultEngine, type EnginePreference, fallbackDecision } from '../engine/policy';
import { clearEngines, fallbackEngine, getEngine, listEngines, registerEngine, resolveEngine } from '../engine/registry';
import type { EngineError } from '../engine/types';
import { createMockEngine } from '../testing/mockEngine';

describe('engine registry', () => {
  afterEach(clearEngines);

  it('registers, replaces and unregisters', () => {
    const video = createMockEngine('video');
    const unregister = registerEngine(video);
    expect(getEngine('video')).toBe(video);
    const replacement = createMockEngine('video');
    registerEngine(replacement);
    unregister();
    expect(getEngine('video')).toBe(replacement);
    expect(listEngines()).toEqual([replacement]);
  });

  it('resolves the preferred engine, else the other available one', () => {
    const video = createMockEngine('video');
    const mpv = createMockEngine('mpv', false);
    registerEngine(video);
    expect(resolveEngine('mpv')).toBe(video);
    registerEngine(mpv);
    expect(resolveEngine('mpv')).toBe(video);
    mpv.available = true;
    expect(resolveEngine('mpv')).toBe(mpv);
    expect(fallbackEngine('mpv')).toBe(video);
    video.available = false;
    expect(fallbackEngine('mpv')).toBeUndefined();
    expect(resolveEngine('video')).toBe(mpv);
  });

  it('resolves nothing when no engine is registered', () => {
    expect(resolveEngine('video')).toBeUndefined();
  });
});

describe('engine choice', () => {
  it.each<[string, EnginePreference, string]>([
    ['ios', 'auto', 'mpv'],
    ['ios', 'video', 'video'],
    ['ios', 'mpv', 'mpv'],
    ['android', 'auto', 'video'],
    ['android', 'video', 'video'],
    ['android', 'mpv', 'mpv'],
  ])('%s with %s -> %s', (platform, preference, expected) => {
    expect(chooseEngine(preference, platform)).toBe(expected);
  });

  it('defaults per platform', () => {
    expect(defaultEngine('ios')).toBe('mpv');
    expect(defaultEngine('android')).toBe('video');
  });

  it('chooses video up front for DRM sources', () => {
    expect(chooseEngine('auto', 'ios', { drm: { type: 'widevine' } })).toBe('video');
    expect(chooseEngine('mpv', 'android', { drm: { type: 'widevine' } })).toBe('video');
  });
});

describe('fallback decision', () => {
  const error = (reason: EngineError['reason'], phase: EngineError['phase'] = 'playback') => ({ reason, phase });
  const loaded = { loaded: true, fallbackUsed: false };
  const fresh = { loaded: false, fallbackUsed: false };

  it('iOS mpv falls back to video on init / open errors and DRM', () => {
    expect(fallbackDecision('ios', 'mpv', error('init', 'init'), fresh)).toBe('video');
    expect(fallbackDecision('ios', 'mpv', error('open'), loaded)).toBe('video');
    expect(fallbackDecision('ios', 'mpv', error('network'), fresh)).toBe('video');
    expect(fallbackDecision('ios', 'mpv', error('drm'), loaded)).toBe('video');
    expect(fallbackDecision('ios', 'mpv', error('other'), { ...loaded, source: { drm: { type: 'fairplay' } } })).toBe('video');
    expect(fallbackDecision('ios', 'mpv', error('network'), loaded)).toBeUndefined();
  });

  it('Android video falls back to mpv on init, format and decoder errors only', () => {
    expect(fallbackDecision('android', 'video', error('other', 'init'), fresh)).toBe('mpv');
    expect(fallbackDecision('android', 'video', error('format'), loaded)).toBe('mpv');
    expect(fallbackDecision('android', 'video', error('decoder'), fresh)).toBe('mpv');
    expect(fallbackDecision('android', 'video', error('network'), fresh)).toBeUndefined();
    expect(fallbackDecision('android', 'video', error('open'), fresh)).toBeUndefined();
    expect(fallbackDecision('android', 'video', error('other'), loaded)).toBeUndefined();
  });

  it('other combinations fall back on init failure only', () => {
    expect(fallbackDecision('ios', 'video', error('init', 'init'), fresh)).toBe('mpv');
    expect(fallbackDecision('ios', 'video', error('format'), fresh)).toBeUndefined();
    expect(fallbackDecision('android', 'mpv', error('init'), fresh)).toBe('video');
    expect(fallbackDecision('android', 'mpv', error('decoder'), fresh)).toBeUndefined();
  });

  it('never falls back twice for one item', () => {
    const used = { loaded: false, fallbackUsed: true };
    expect(fallbackDecision('ios', 'mpv', error('init', 'init'), used)).toBeUndefined();
    expect(fallbackDecision('android', 'video', error('decoder'), used)).toBeUndefined();
  });
});
