import { episodeLabel, trackLabel } from '../format';

describe('trackLabel', () => {
  it('prefers a human track name', () => {
    expect(trackLabel({ label: '国语', language: 'zh' })).toBe('国语');
    expect(trackLabel({ label: 'Director Commentary', language: 'en' })).toBe('Director Commentary');
  });

  it('maps ISO 639-1/639-2 codes from the label or the language', () => {
    expect(trackLabel({ label: 'eng' })).toBe('英语');
    expect(trackLabel({ label: '', language: 'JPN' })).toBe('日语');
    expect(trackLabel({ label: 'und', language: 'ko' })).toBe('韩语');
    for (const [code, name] of [
      ['zh', '中文'],
      ['chi', '中文'],
      ['zho', '中文'],
      ['cmn', '中文'],
      ['yue', '粤语'],
      ['fre', '法语'],
      ['fra', '法语'],
      ['ger', '德语'],
      ['deu', '德语'],
      ['spa', '西班牙语'],
      ['rus', '俄语'],
      ['tha', '泰语'],
      ['en-US', '英语'],
    ]) {
      expect(trackLabel({ label: '', language: code })).toBe(name);
    }
    expect(trackLabel({ label: 'fr' })).toBe('法语');
  });

  it('tells simplified and traditional Chinese apart by script or region', () => {
    expect(trackLabel({ label: '', language: 'zh-Hant' })).toBe('繁体中文');
    expect(trackLabel({ label: '', language: 'zh_TW' })).toBe('繁体中文');
    expect(trackLabel({ label: 'zh-HK' })).toBe('繁体中文');
    expect(trackLabel({ label: '', language: 'zh-Hant-TW' })).toBe('繁体中文');
    expect(trackLabel({ label: '', language: 'zh-Hans' })).toBe('简体中文');
    expect(trackLabel({ label: 'zh-CN' })).toBe('简体中文');
    expect(trackLabel({ label: '', language: 'chi-cn' })).toBe('简体中文');
  });

  it('returns undefined for und, unknown and empty', () => {
    expect(trackLabel({ label: '', language: 'und' })).toBeUndefined();
    expect(trackLabel({ label: 'und' })).toBeUndefined();
    expect(trackLabel({ label: 'Unknown', language: '' })).toBeUndefined();
    expect(trackLabel({ label: ' ' })).toBeUndefined();
    expect(trackLabel({})).toBeUndefined();
  });

  it('keeps an unmapped code rather than dropping it', () => {
    expect(trackLabel({ label: '', language: 'it' })).toBe('it');
  });
});

describe('episodeLabel', () => {
  it('prefixes a descriptive name with the episode number', () => {
    expect(episodeLabel(0, '风起')).toBe('第 1 集·风起');
    expect(episodeLabel(4, 'HD中字')).toBe('第 5 集·HD中字');
  });

  it('shows only the number when the name is empty or a bare number', () => {
    expect(episodeLabel(0, '')).toBe('第 1 集');
    expect(episodeLabel(0, '1')).toBe('第 1 集');
    expect(episodeLabel(11, ' 12 ')).toBe('第 12 集');
  });

  it('keeps a name that is already an episode label', () => {
    expect(episodeLabel(0, '第1集')).toBe('第1集');
    expect(episodeLabel(2, '第 03 话')).toBe('第 03 话');
    expect(episodeLabel(9, '第十集')).toBe('第十集');
    expect(episodeLabel(0, 'EP01')).toBe('EP01');
    expect(episodeLabel(1, 'Ep 2')).toBe('Ep 2');
    expect(episodeLabel(2, 'E03')).toBe('E03');
  });
});
