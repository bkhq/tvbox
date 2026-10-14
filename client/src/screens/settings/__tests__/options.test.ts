import { CHOICES, choiceOptions, formatSpeed, formatText, optionLabel, STEPS, stepValue, vodStatusText } from '../options';

describe('settings options', () => {
  it('labels choices and falls back to the raw value', () => {
    expect(optionLabel(choiceOptions('playerEngine'), 'auto')).toBe('自动（iOS 默认 MPV，Android 默认系统播放器）');
    expect(optionLabel(choiceOptions('playerEngine'), 'video')).toBe('系统播放器');
    expect(optionLabel(choiceOptions('playerEngine'), 'mpv')).toBe('MPV');
    expect(optionLabel(choiceOptions('decode'), 'hard')).toBe('硬解');
    expect(optionLabel(choiceOptions('decode'), 'soft')).toBe('软解');
    expect(optionLabel(choiceOptions('scale'), 3)).toBe('填充');
    expect(optionLabel<number>(choiceOptions('scale'), 9)).toBe('9');
  });

  it('offers only values the schema accepts', () => {
    expect(CHOICES.render.map((option) => option.value)).toEqual(['surface', 'texture']);
  });

  it('steps decimals without float drift and clamps to the schema range', () => {
    expect(stepValue('subtitleScale', 1, 1)).toBe(1.1);
    expect(stepValue('subtitleScale', 1.1, 1)).toBe(1.2);
    expect(stepValue('subtitleScale', 2, 1)).toBe(2);
    expect(stepValue('subtitleScale', 0.5, -1)).toBe(0.5);
    expect(stepValue('subtitlePosition', 30, 1)).toBe(30);
    expect(stepValue('subtitlePosition', -20, -1)).toBe(-20);
    expect(stepValue('speedLongPress', 2, 1)).toBe(2.5);
    expect(stepValue('speedLongPress', 2, -1)).toBe(2);
    expect(stepValue('buffer', 10, 1)).toBe(10);
    expect(stepValue('buffer', 1, 1)).toBe(2);
  });

  it('formats values', () => {
    expect(STEPS.subtitleScale.format(1)).toBe('1.0x');
    expect(STEPS.speedLongPress.format(2.5)).toBe('2.5x');
    expect(formatSpeed(1)).toBe('1x');
    expect(formatText('')).toBe('未设置');
    expect(formatText('abc')).toBe('abc');
  });

  it('describes the VOD config status', () => {
    const entry = { id: 1, url: 'https://a/c.json', name: '', time: 0 };
    expect(vodStatusText({ status: 'loading' })).toBe('加载中…');
    expect(vodStatusText({ status: 'loading', entry })).toBe('https://a/c.json（加载中…）');
    expect(vodStatusText({ status: 'ready', entry: { ...entry, name: '我的' } })).toBe('我的');
    expect(vodStatusText({ status: 'empty' })).toBe('未设置');
    expect(vodStatusText({ status: 'error', entry, error: new Error('HTTP 404') })).toBe('加载失败：HTTP 404');
  });
});
