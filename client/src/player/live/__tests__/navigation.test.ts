import { type Group, normalizeChannel, normalizeGroup, normalizeLive } from '../../../core/types';
import { fixture } from '../__fixtures__/read';
import { buildCatchupUrl, channelCatchup, hasCatchup, rtspRange } from '../catchup';
import { channelUrl, lineName } from '../channel';
import {
  channelForKey,
  findByChannelNumber,
  findKeepPosition,
  keepValue,
  lineAfterError,
  moveChannel,
  nextChannel,
  prevChannel,
  splitHiddenGroups,
  switchLine,
  unlockGroups,
} from '../navigation';
import { parseLiveText } from '../parser';

const group = (name: string, channels: string[], pass = ''): Group =>
  normalizeGroup({ name, pass, channel: channels.map((c) => ({ name: c, urls: [`http://${c}`] })) });

const all = [group('收藏', []), group('A', ['a1', 'a2', 'a3']), group('B', []), group('C', ['c1']), group('D', ['d1'], '1234'), group('E', ['e1'], '1234'), group('F', ['f1'], '99')];
const { visible, hidden } = splitHiddenGroups(all);

describe('hidden groups', () => {
  it('hides groups with a password and unlocks them by password', () => {
    expect(visible.map((g) => g.name)).toEqual(['收藏', 'A', 'B', 'C']);
    expect(hidden.map((g) => g.name)).toEqual(['D', 'E', 'F']);
    const unlocked = unlockGroups(visible, hidden, '1234');
    expect(unlocked.visible.map((g) => g.name)).toEqual(['收藏', 'A', 'B', 'C', 'D', 'E']);
    expect(unlocked.hidden.map((g) => g.name)).toEqual(['F']);
    expect(unlocked.selected).toBe(4);
    expect(unlockGroups(visible, hidden, 'nope')).toEqual({ visible, hidden, selected: undefined });
  });
});

describe('moveChannel', () => {
  it('wraps within the group when across is off', () => {
    expect(nextChannel(visible, { group: 1, channel: 2 }, false)).toEqual({ group: 1, channel: 0 });
    expect(prevChannel(visible, { group: 1, channel: 0 }, false)).toEqual({ group: 1, channel: 2 });
    expect(nextChannel(visible, { group: 1, channel: 0 }, true)).toEqual({ group: 1, channel: 1 });
  });

  it('moves across groups skipping the keep group and empty groups', () => {
    expect(nextChannel(visible, { group: 1, channel: 2 }, true)).toEqual({ group: 3, channel: 0 });
    expect(nextChannel(visible, { group: 3, channel: 0 }, true)).toEqual({ group: 1, channel: 0 });
    expect(prevChannel(visible, { group: 1, channel: 0 }, true)).toEqual({ group: 3, channel: 0 });
    expect(prevChannel(visible, { group: 3, channel: 0 }, true)).toEqual({ group: 1, channel: 2 });
  });

  it('stays put when no other group qualifies, and does nothing in an empty group', () => {
    const single = [group('A', ['a1', 'a2'])];
    expect(nextChannel(single, { group: 0, channel: 1 }, true)).toEqual({ group: 0, channel: 1 });
    const withKeep = [group('收藏', ['k']), group('A', ['a1'])];
    expect(nextChannel(withKeep, { group: 1, channel: 0 }, true)).toEqual({ group: 1, channel: 0 });
    expect(moveChannel(visible, { group: 2, channel: 0 }, 1, true)).toBeUndefined();
  });

  it('maps up / down keys with invert', () => {
    const position = { group: 1, channel: 1 };
    expect(channelForKey(visible, position, 'up', { across: false, invert: false })).toEqual({ group: 1, channel: 0 });
    expect(channelForKey(visible, position, 'down', { across: false, invert: false })).toEqual({ group: 1, channel: 2 });
    expect(channelForKey(visible, position, 'up', { across: false, invert: true })).toEqual({ group: 1, channel: 2 });
    expect(channelForKey(visible, position, 'down', { across: false, invert: true })).toEqual({ group: 1, channel: 0 });
  });
});

describe('lines', () => {
  const channel = normalizeChannel({ name: 'x', urls: ['http://1$主线', 'http://2', 'http://3'] });

  it('switches lines with wrap-around and labels them', () => {
    expect(switchLine(channel, 2, true)).toBe(0);
    expect(switchLine(channel, 0, false)).toBe(2);
    expect(switchLine(normalizeChannel({ urls: ['http://1'] }), 0, true)).toBe(0);
    expect(channelUrl(channel, 0)).toBe('http://1');
    expect(lineName(channel, 0)).toBe('主线');
    expect(lineName(channel, 1)).toBe('线路 2');
    expect(lineName(normalizeChannel({ urls: ['http://1$a'] }), 0)).toBe('');
  });

  it('falls back to the next line on error only with change on and before the last line', () => {
    expect(lineAfterError(channel, 0, true)).toBe(1);
    expect(lineAfterError(channel, 2, true)).toBeUndefined();
    expect(lineAfterError(channel, 0, false)).toBeUndefined();
  });
});

describe('lookups', () => {
  const groups = parseLiveText(fixture('playlist.m3u'), normalizeLive({ name: 't' }));

  it('finds channels by number', () => {
    // Java compares against the zero-padded number, so tvg-chno="20" is not found as "020".
    expect(findByChannelNumber(groups, '20')).toBeUndefined();
    expect(findByChannelNumber(groups, '2')).toEqual({ group: 1, channel: 1 });
    expect(findByChannelNumber(groups, '0004')).toEqual({ group: 3, channel: 0 });
    expect(findByChannelNumber(groups, '999')).toBeUndefined();
    expect(findByChannelNumber(groups, 'abc')).toBeUndefined();
  });

  it('restores the kept channel and line', () => {
    const cctv = groups[0]!.channel[0]!;
    const keep = keepValue(groups[0]!, cctv, 'http://b.example.com/cctv1.m3u8');
    expect(keep).toBe('央视@@@CCTV-1 综合@@@http://b.example.com/cctv1.m3u8');
    expect(findKeepPosition(groups, keep)).toEqual({ group: 0, channel: 0, line: 1 });
    expect(findKeepPosition(groups, '央视@@@missing@@@x')).toEqual({ group: 1, channel: 0, line: 0 });
    expect(findKeepPosition(groups, '')).toEqual({ group: 1, channel: 0, line: 0 });
  });
});

describe('catchup', () => {
  const range = { startTime: Date.parse('2026-10-04T11:00:00Z'), endTime: Date.parse('2026-10-04T12:00:00Z') };
  const groups = parseLiveText(fixture('playlist.m3u'), normalizeLive({ name: 't' }));
  const cctv = groups[0]!.channel[0]!;
  const hunan = groups[1]!.channel[0]!;

  it('appends the playlist template, switching to "&" when the url has a query', () => {
    expect(hasCatchup(cctv, 0)).toBe(true);
    const catchup = channelCatchup(cctv, 0);
    expect(buildCatchupUrl(catchup, channelUrl(cctv, 0), range, 'Asia/Shanghai')).toBe(
      'http://a.example.com/cctv1.m3u8?playseek=20261004190000-20261004200000',
    );
    expect(buildCatchupUrl(catchup, 'http://a/x.m3u8?t=1', range, 'UTC')).toBe('http://a/x.m3u8?t=1&playseek=20261004110000-20261004120000');
  });

  it('builds "default" templates from utc tokens', () => {
    expect(buildCatchupUrl(hunan.catchup, channelUrl(hunan, 0), range)).toBe(
      `http://tv.example.com/${range.startTime / 1000}/${range.endTime / 1000}`,
    );
  });

  it('uses the PLTV default for /PLTV/ urls and honours regex', () => {
    const pltv = normalizeChannel({ name: 'p', urls: ['http://x/PLTV/88/1.smil?a=1'] });
    expect(hasCatchup(pltv, 0)).toBe(true);
    expect(buildCatchupUrl(channelCatchup(pltv, 0), channelUrl(pltv, 0), range, 'UTC')).toBe(
      'http://x/TVOD/88/1.smil?a=1&playseek=20261004110000-20261004120000',
    );
    const other = normalizeChannel({ name: 'o', urls: ['http://x/live'], catchup: { source: '?s', regex: 'nomatch' } });
    expect(hasCatchup(other, 0)).toBe(false);
    expect(hasCatchup(normalizeChannel({ name: 'n', urls: ['http://x/live'] }), 0)).toBe(false);
  });

  it('formats the RTSP clock range in UTC', () => {
    expect(rtspRange(range)).toBe('clock=20261004T110000Z-20261004T120000Z');
  });
});
