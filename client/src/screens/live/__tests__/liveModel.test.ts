import type { Group } from '../../../core/types';
import { emptyChannel } from '../../../player/live/channel';
import {
  channelNumberLabel,
  initialSelection,
  itemForSelection,
  lineLabel,
  liveGroupChannels,
  liveGroupItems,
  nowAndNext,
  programmeProgress,
} from '../liveModel';
import { createLiveGestures } from '../useLiveGestures';
import { liveRemoteAction } from '../useLiveRemote';

const channel = (name: string, urls = ['http://x/' + name]) => ({ ...emptyChannel(name), urls });
const groups: Group[] = [
  { name: '收藏', pass: '', channel: [channel('K')] },
  { name: '央视', pass: '', channel: [channel('CCTV1', ['http://a', 'http://b']), channel('CCTV2')] },
];

describe('initialSelection', () => {
  it('prefers a valid route position, then the keep, then group 1', () => {
    expect(initialSelection(groups, { groupIndex: 1, channelIndex: 1 }, '')).toEqual({ group: 1, channel: 1, line: 0 });
    expect(initialSelection(groups, { groupIndex: 5 }, '央视@@@CCTV1@@@http://b')).toEqual({
      group: 1,
      channel: 0,
      line: 1,
    });
    expect(initialSelection(groups, undefined, '')).toEqual({ group: 1, channel: 0, line: 0 });
  });

  it('falls back to the keep group, or nothing without channels', () => {
    expect(initialSelection([groups[0]!], undefined, '')).toEqual({ group: 0, channel: 0, line: 0 });
    expect(initialSelection([{ name: '收藏', pass: '', channel: [] }], undefined, '')).toBeUndefined();
  });
});

describe('live helpers', () => {
  it('labels lines and finds the current and next programme', () => {
    expect(lineLabel(groups[1]!.channel[0]!, 1)).toBe('线路 2/2');
    expect(lineLabel(groups[1]!.channel[1]!, 0)).toBe('');
    const list = [
      { title: 'a', start: '', end: '', startTime: 0, endTime: 10 },
      { title: 'b', start: '', end: '', startTime: 10, endTime: 20 },
    ];
    expect(nowAndNext({ key: '', date: '', list }, 5)).toEqual({ current: list[0], next: list[1] });
    expect(nowAndNext({ key: '', date: '', list }, 50)).toEqual({});
  });

  it('maps remote keys', () => {
    expect(liveRemoteAction('channelUp')).toEqual({ type: 'channel', key: 'up' });
    expect(liveRemoteAction('down')).toEqual({ type: 'channel', key: 'down' });
    expect(liveRemoteAction('left')).toEqual({ type: 'line', next: false });
    expect(liveRemoteAction('next')).toEqual({ type: 'step', delta: 1 });
    expect(liveRemoteAction('select')).toEqual({ type: 'list' });
    // jest-expo runs as iOS: menu is back on tvOS.
    expect(liveRemoteAction('menu')).toBeUndefined();
    expect(liveRemoteAction('blur')).toBeUndefined();
  });

  it('turns a tap and vertical swipes into gestures', () => {
    const gestures = createLiveGestures();
    const handlers = { onTap: jest.fn(), onSwipe: jest.fn() };
    gestures.setHandlers(handlers);
    gestures.release({ dx: 2, dy: 3 });
    gestures.release({ dx: 10, dy: -120 });
    gestures.release({ dx: 0, dy: 90 });
    gestures.release({ dx: 200, dy: 80 });
    expect(handlers.onTap).toHaveBeenCalledTimes(1);
    expect(handlers.onSwipe.mock.calls).toEqual([['up'], ['down']]);
  });
});

describe('group list view model', () => {
  const live: Group[] = [
    { name: '收藏', pass: '', channel: [] },
    { name: '央视', pass: '', channel: [channel('CCTV1'), channel('CCTV2')] },
    { name: '高清', pass: '', channel: [channel('CCTV1'), channel('HD1')] },
  ];
  const withKeep: Group[] = [{ ...live[0]!, channel: [channel('CCTV2')] }, ...live.slice(1)];

  it('lists 全部 first with deduped count and hides an empty 收藏', () => {
    expect(liveGroupItems(live)).toEqual([
      { key: 'all', name: '全部', count: 3, kind: 'all' },
      { key: 'group-1', name: '央视', count: 2, kind: 'group', groupIndex: 1 },
      { key: 'group-2', name: '高清', count: 2, kind: 'group', groupIndex: 2 },
    ]);
  });

  it('shows 收藏 after 全部 when it has channels', () => {
    const items = liveGroupItems(withKeep);
    expect(items.map((item) => item.kind)).toEqual(['all', 'keep', 'group', 'group']);
    expect(items[0]!.count).toBe(3);
    expect(items[1]).toEqual({ key: 'keep', name: '收藏', count: 1, kind: 'keep', groupIndex: 0 });
  });

  it('maps items to real channel positions', () => {
    const items = liveGroupItems(withKeep);
    expect(liveGroupChannels(withKeep, items[0]!)).toEqual([
      { group: 1, channel: 0 },
      { group: 1, channel: 1 },
      { group: 2, channel: 1 },
    ]);
    expect(liveGroupChannels(withKeep, items[1]!)).toEqual([{ group: 0, channel: 0 }]);
    expect(liveGroupChannels(withKeep, items[3]!)).toEqual([
      { group: 2, channel: 0 },
      { group: 2, channel: 1 },
    ]);
  });

  it('highlights 收藏 only for a selection in the keep group', () => {
    const items = liveGroupItems(withKeep);
    expect(itemForSelection(items, withKeep, { group: 0, channel: 0 })?.kind).toBe('keep');
    expect(itemForSelection(items, withKeep, { group: 2, channel: 1 })?.kind).toBe('all');
    expect(itemForSelection(items, withKeep, undefined)?.kind).toBe('all');
    expect(itemForSelection(liveGroupItems(live), live, { group: 0, channel: 0 })?.kind).toBe('all');
  });

  it('labels channel numbers with two digits', () => {
    expect(channelNumberLabel({ ...channel('A'), number: '2' }, 7)).toBe('02');
    expect(channelNumberLabel({ ...channel('A'), number: '002' }, 7)).toBe('02');
    expect(channelNumberLabel({ ...channel('A'), number: '123' }, 7)).toBe('123');
    expect(channelNumberLabel(channel('A'), 0)).toBe('01');
    expect(channelNumberLabel(channel('A'), 11)).toBe('12');
  });

  it('reports programme progress clamped to [0, 1]', () => {
    const item = { title: 'a', start: '10:00', end: '11:00', startTime: 1000, endTime: 2000 };
    expect(programmeProgress(item, 1250)).toEqual({ start: '10:00', end: '11:00', fraction: 0.25 });
    expect(programmeProgress(item, 500)?.fraction).toBe(0);
    expect(programmeProgress(item, 5000)?.fraction).toBe(1);
    expect(programmeProgress(undefined, 1000)).toBeUndefined();
    expect(programmeProgress({ ...item, endTime: 1000 }, 1000)).toBeUndefined();
    expect(programmeProgress({ ...item, start: '', end: '' }, 1000)).toBeUndefined();
  });
});
