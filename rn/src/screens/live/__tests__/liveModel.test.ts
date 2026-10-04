import type { Group } from '../../../core/types';
import { emptyChannel } from '../../../player/live/channel';
import { initialSelection, lineLabel, nowAndNext } from '../liveModel';
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
    expect(initialSelection(groups, { groupIndex: 5 }, '央视@@@CCTV1@@@http://b')).toEqual({ group: 1, channel: 0, line: 1 });
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
