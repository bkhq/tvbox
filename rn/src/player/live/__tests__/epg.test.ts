import type { FetchLike } from '../../../core/http';
import { normalizeChannel, normalizeLive } from '../../../core/types';
import { fixture, fixtureBytes } from '../__fixtures__/read';
import {
  applyXmltvLogos,
  currentProgramme,
  decodeEpgBytes,
  epgXmlUrls,
  fetchChannelEpg,
  formatEpgItem,
  loadXmltv,
  parseEpgResponse,
  parseEpgXml,
  parseXmltv,
  parseXmltvTime,
  programmesForDate,
  xmltvEpgs,
} from '../epg';
import { parseLiveText } from '../parser';

const SH = 'Asia/Shanghai';
const utc = (iso: string) => Date.parse(iso);
const groups = parseLiveText(fixture('playlist.m3u'), normalizeLive({ name: 't' }));
const channel = (name: string) => groups.flatMap((group) => group.channel).find((c) => c.name === name)!;

describe('parseXmltvTime', () => {
  it('honours explicit offsets and applies the live time zone otherwise', () => {
    expect(parseXmltvTime('20261004190000 +0800', 'UTC')).toBe(utc('2026-10-04T11:00:00Z'));
    expect(parseXmltvTime('20261004190000 +08:00', 'UTC')).toBe(utc('2026-10-04T11:00:00Z'));
    expect(parseXmltvTime('20261004190000', SH)).toBe(utc('2026-10-04T11:00:00Z'));
    expect(parseXmltvTime('20261004190000', 'GMT+8')).toBe(utc('2026-10-04T11:00:00Z'));
    expect(parseXmltvTime('20261004190000', 'UTC')).toBe(utc('2026-10-04T19:00:00Z'));
    expect(parseXmltvTime('20260329023000', 'Europe/Berlin')).toBe(utc('2026-03-29T01:30:00Z'));
  });

  it('falls back to the device zone for unknown zones and to the epoch for bad input', () => {
    expect(parseXmltvTime('20261004190000', 'Mars/Phobos')).toBe(parseXmltvTime('20261004190000', ''));
    expect(parseXmltvTime('2026100419', SH)).toBe(0);
    expect(parseXmltvTime('20261304190000 +0800', SH)).toBe(0);
  });
});

describe('parseXmltv', () => {
  const xml = fixture('epg.xml');

  it('matches channels by tvg-id, then by display name against tvg-name / name', () => {
    const data = parseXmltv(xml, groups, SH);
    expect(Object.keys(data.epg).sort()).toEqual(['cctv1', '浙江', '湖南卫视'].sort());
    expect(xmltvEpgs(data, channel('浙江卫视'))[0]!.list.map((item) => item.title)).toEqual(['浙江午间']);
    expect(xmltvEpgs(data, channel('无分组频道'))).toEqual([]);
  });

  it('buckets programmes by date in the live time zone', () => {
    const shanghai = xmltvEpgs(parseXmltv(xml, groups, SH), channel('CCTV-1 综合'));
    expect(shanghai.map((epg) => [epg.key, epg.date, epg.list.length])).toEqual([
      ['cctv1', '2026-10-04', 2],
      ['cctv1', '2026-10-05', 1],
    ]);
    expect(shanghai[0]!.list[0]).toEqual({
      title: '新闻联播',
      start: '19:00',
      end: '20:00',
      startTime: utc('2026-10-04T11:00:00Z'),
      endTime: utc('2026-10-04T12:00:00Z'),
    });
    expect(shanghai[0]!.list[1]!.title).toBe('Evening Film');
    expect(shanghai[1]!.list[0]!.title).toBe('午夜新闻 & 天气');

    const london = xmltvEpgs(parseXmltv(xml, groups, 'UTC'), channel('CCTV-1 综合'));
    expect(london.map((epg) => [epg.date, epg.list.length])).toEqual([['2026-10-04', 3]]);
    expect(london[0]!.list[0]!.start).toBe('11:00');
  });

  it('fills empty logos from XMLTV icons', () => {
    const bound = applyXmltvLogos(groups, parseXmltv(xml, groups, SH));
    const logos = bound.flatMap((group) => group.channel.map((c) => c.logo));
    expect(logos).toEqual(['http://icon.example.com/cctv1.png', '', 'http://icon.example.com/zj.png', '', '']);
  });

  it('reads gzip XMLTV', () => {
    expect(decodeEpgBytes(fixtureBytes('epg.xml.gz'))).toBe(xml);
    expect(decodeEpgBytes(fixtureBytes('epg.xml'))).toBe(xml);
  });
});

describe('loadXmltv', () => {
  it('downloads the xml / gz urls of the live epg and skips failures', async () => {
    const gz = fixtureBytes('epg.xml.gz');
    const fetch: jest.MockedFunction<FetchLike> = jest.fn(async (url: string) => {
      if (url.includes('bad')) return { ok: false, status: 500, url } as Response;
      return { ok: true, status: 200, url, arrayBuffer: async () => gz.slice().buffer } as unknown as Response;
    });
    const live = normalizeLive({ epg: 'http://bad/e.xml,http://e/epg.xml.gz,http://api/{name}', timeZone: SH });
    expect(epgXmlUrls(live)).toEqual(['http://bad/e.xml', 'http://e/epg.xml.gz']);
    const { ok, data } = await loadXmltv(live, groups, { fetch });
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(xmltvEpgs(data, channel('湖南卫视'))[0]!.list[0]!.start).toBe('16:00');
  });
});

describe('per-channel EPG responses', () => {
  it('parses JSON EPG with dedupe, cross-midnight end and invalid times', () => {
    const epg = parseEpgResponse(fixture('epg-day.json'), 'cctv1', SH);
    expect(epg.key).toBe('cctv1');
    expect(epg.date).toBe('2026-10-04');
    expect(epg.list.map((item) => item.title)).toEqual(['朝闻天下', '新闻联播', '晚间新闻', '坏数据']);
    expect(epg.list[0]!.startTime).toBe(utc('2026-10-03T22:00:00Z'));
    expect(epg.list[2]!.endTime).toBe(utc('2026-10-04T16:30:00Z'));
    expect(epg.list[3]!.startTime).toBe(0);
    expect(formatEpgItem(epg.list[1]!)).toBe('19:00 ~ 19:30  新闻联播');
  });

  it('parses an XMLTV response as one day', () => {
    const epg = parseEpgResponse(fixture('epg.xml'), 'k', SH);
    expect(epg.date).toBe('2026-10-04');
    expect(epg.list).toHaveLength(6);
    expect(parseEpgXml(fixture('epg.xml'), 'k', 'UTC').date).toBe('2026-10-03');
    expect(parseEpgXml('<tv><programme/></tv>', 'k', SH, utc('2026-10-04T20:00:00Z')).date).toBe('2026-10-05');
  });

  it('fetches yesterday / today / tomorrow from the {date} template, skipping known dates', async () => {
    const fetch: jest.MockedFunction<FetchLike> = jest.fn(async (url: string) => {
      const date = new URL(url).searchParams.get('date')!;
      const body = date === '2026-10-04' ? fixture('epg-day.json') : JSON.stringify({ date, epg_data: [{ title: date, start: '00:00', end: '01:00' }] });
      return { ok: true, status: 200, url, text: async () => body } as Response;
    });
    const item = normalizeChannel({ name: 'CCTV1', epg: 'http://api/epg?ch=CCTV1&date={date}' });
    const existing = [{ key: 'CCTV1', date: '2026-10-03', list: [] }];
    const now = utc('2026-10-04T04:00:00Z');
    const { list, today } = await fetchChannelEpg(item, SH, existing, { fetch, now });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://api/epg?ch=CCTV1&date=2026-10-04',
      'http://api/epg?ch=CCTV1&date=2026-10-05',
    ]);
    expect(list.map((epg) => epg.date)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(today.date).toBe('2026-10-04');
    expect(today.key).toBe('CCTV1');
    expect(currentProgramme(today, now)).toBeUndefined();
    expect(currentProgramme(today, utc('2026-10-04T11:10:00Z'))?.title).toBe('新闻联播');
    expect(programmesForDate(list, '2026-10-05').map((p) => p.title)).toEqual(['2026-10-05']);
    expect(programmesForDate(list, '2026-10-09')).toEqual([]);
  });

  it('does not fetch non-http templates', async () => {
    const fetch = jest.fn();
    const { today } = await fetchChannelEpg(normalizeChannel({ name: 'a', epg: '{date}' }), SH, [], { fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(today.list).toEqual([]);
  });
});
