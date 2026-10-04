import { normalizeLive } from '../../../core/types';
import { fixture } from '../__fixtures__/read';
import { parseLive, parseLiveText } from '../parser';

const live = (extra: Record<string, unknown> = {}) => normalizeLive({ name: 'test', url: 'http://x/list', ...extra });

describe('parseLive: M3U', () => {
  const result = parseLive(fixture('playlist.m3u'), live());
  const [cctv, hunan, zj, plain, vip] = result.groups.flatMap((group) => group.channel);

  it('creates groups in playlist order, with defaults and password groups', () => {
    expect(result.groups.map((group) => [group.name, group.pass, group.channel.map((c) => c.name)])).toEqual([
      ['央视', '', ['CCTV-1 综合']],
      ['卫视', '', ['湖南卫视', '浙江卫视']],
      ['直播', '', ['无分组频道']],
      ['VIP', '1234', ['秘密频道']],
    ]);
  });

  it('takes the epg url from the #EXTM3U header', () => {
    expect(result.epg).toBe('http://epg.example.com/e.xml.gz');
    expect(parseLive(fixture('playlist.m3u'), live({ epg: 'http://own/e.xml' })).epg).toBe('http://own/e.xml');
  });

  it('merges duplicate names and lets the later #EXTINF overwrite attributes like Java', () => {
    expect(cctv!.urls).toEqual(['http://a.example.com/cctv1.m3u8', 'http://b.example.com/cctv1.m3u8']);
    expect(cctv!.tvgId).toBe('cctv1');
    expect(cctv!.tvgName).toBe('CCTV1');
    expect(cctv!.logo).toBe('');
    expect(cctv!.ua).toBe('');
    expect(cctv!.referer).toBe('http://ref.example.com/');
    expect(cctv!.header).toEqual({ 'User-Agent': 'PipeUA', Referer: 'http://pipe.example.com/' });
  });

  it('applies playlist catchup unless the channel has its own', () => {
    expect(cctv!.catchup).toEqual({
      type: 'append',
      days: '',
      regex: '',
      source: '?playseek=${(b)yyyyMMddHHmmss}-${(e)yyyyMMddHHmmss}',
      replace: '',
    });
    expect(hunan!.catchup.type).toBe('default');
    expect(hunan!.catchup.source).toBe('http://tv.example.com/{utc:x}/{utcend:x}');
  });

  it('reads #KODIPROP and #EXTHTTP options', () => {
    expect(hunan!.format).toBe('application/dash+xml');
    expect(hunan!.header).toEqual({ 'X-Token': 'abc', Origin: 'http://o.example.com' });
    expect(zj!.header).toEqual({ Cookie: 'k=v' });
    expect(zj!.tvgName).toBe('浙江');
  });

  it('numbers channels without tvg-chno sequentially', () => {
    expect([cctv, hunan, zj, plain, vip].map((c) => c!.number)).toEqual(['001', '20', '002', '003', '004']);
  });

  it('keeps "_" in the name when the live source is unlocked (pass)', () => {
    const groups = parseLiveText(fixture('playlist.m3u'), live({ pass: true }));
    expect(groups[3]).toMatchObject({ name: 'VIP', pass: '' });
  });

  it('returns a live that already has groups unchanged', () => {
    const source = live({ groups: [{ name: 'A', channel: [{ name: 'a', urls: ['http://a'] }] }] });
    expect(parseLive('#EXTM3U', source)).toBe(source);
  });
});

describe('parseLive: TXT', () => {
  const groups = parseLiveText(fixture('channels.txt'), live());

  it('builds genre groups, a default group for leading channels and password groups', () => {
    expect(groups.map((group) => [group.name, group.pass, group.channel.map((c) => c.name)])).toEqual([
      ['直播', '', ['CCTV0']],
      ['央视频道', '', ['CCTV1', 'CCTV2']],
      ['地方', '8888', ['北京卫视']],
    ]);
  });

  it('splits sources on "#" and merges repeated names', () => {
    const cctv1 = groups[1]!.channel[0]!;
    expect(cctv1.urls).toEqual([
      'http://a.example.com/1.m3u8',
      'http://b.example.com/1.m3u8$备用线路',
      'http://c.example.com/1.m3u8',
    ]);
    expect(cctv1.header).toEqual({ Referer: 'http://ref.txt.example.com/' });
  });

  it('applies "ua=" lines until the next genre', () => {
    expect(groups[1]!.channel.map((c) => c.ua)).toEqual(['TxtUA/2.0', 'TxtUA/2.0']);
    expect(groups[2]!.channel[0]!.ua).toBe('');
    expect(groups[0]!.channel[0]!.ua).toBe('');
  });

  it('numbers channels across groups', () => {
    expect(groups.flatMap((group) => group.channel.map((c) => c.number))).toEqual(['001', '002', '003', '004']);
  });

  it('does not merge repeated genre names', () => {
    const text = 'A,#genre#\nx,http://1\nA,#genre#\nx,http://2';
    expect(parseLiveText(text, live()).map((group) => group.channel[0]!.urls)).toEqual([['http://1'], ['http://2']]);
  });
});

describe('parseLive: JSON and source defaults', () => {
  it('parses a JSON group array', () => {
    const text = JSON.stringify([{ name: 'G_x', channel: [{ name: 'a', urls: ['http://a'], number: '7' }, { name: 'b', urls: ['http://b'] }] }]);
    const groups = parseLiveText(text, live());
    expect(groups[0]).toMatchObject({ name: 'G_x', pass: '' });
    expect(groups[0]!.channel.map((c) => c.number)).toEqual(['7', '001']);
  });

  it('inherits ua / referer / header / catchup and expands epg and logo templates', () => {
    const source = live({
      ua: 'LiveUA',
      referer: 'http://live-ref/',
      header: { 'X-A': '1' },
      catchup: { type: 'append', source: '?seek={utc:x}' },
      epg: 'http://e/all.xml,http://api/epg?ch={name}&id={id}&date={date}',
      logo: 'http://logo/{name}.png',
    });
    const [channel] = parseLiveText('#EXTM3U\n#EXTINF:-1 tvg-id="c1",Name\nhttp://u', source)[0]!.channel;
    expect(channel).toMatchObject({
      ua: 'LiveUA',
      referer: 'http://live-ref/',
      header: { 'X-A': '1' },
      epg: 'http://api/epg?ch=Name&id=c1&date={date}',
      logo: 'http://logo/Name.png',
    });
    expect(channel!.catchup.source).toBe('?seek={utc:x}');
  });

  it('keeps an explicit channel ua and http logo', () => {
    const source = live({ ua: 'LiveUA', logo: 'http://logo/{name}.png' });
    const text = '#EXTM3U\n#EXTINF:-1 tvg-logo="http://own.png" http-user-agent="Own",N\nhttp://u';
    expect(parseLiveText(text, source)[0]!.channel[0]).toMatchObject({ ua: 'Own', logo: 'http://own.png' });
  });
});
