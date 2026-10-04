import type { Group } from '../../../core/types';
import { emptyChannel } from '../channel';
import { createLiveControllerHub, describeGroups } from '../controller';

const channel = (name: string, number = '', logo = '') => ({ ...emptyChannel(name), number, logo, urls: ['http://x/' + name] });
const groups: Group[] = [
  { name: '收藏', pass: '', channel: [] },
  { name: '央视', pass: '', channel: [channel('CCTV1', '001', 'http://l/1.png'), channel('CCTV2', '002')] },
];

describe('live controller', () => {
  it('describes groups with channel index, name, number and logo', () => {
    expect(describeGroups(groups)).toEqual([
      { index: 0, name: '收藏', channels: [] },
      {
        index: 1,
        name: '央视',
        channels: [
          { index: 0, name: 'CCTV1', number: '001', logo: 'http://l/1.png' },
          { index: 1, name: 'CCTV2', number: '002', logo: '' },
        ],
      },
    ]);
  });

  it('lists loaded groups and opens the Live route without a screen', async () => {
    const load = jest.fn(async () => groups);
    const hub = createLiveControllerHub(load);
    const opener = jest.fn();
    hub.setLiveOpener(opener);

    expect((await hub.controller.listGroups()).map((group) => group.name)).toEqual(['收藏', '央视']);
    expect(load).toHaveBeenCalledTimes(1);

    hub.controller.selectChannel(1, 1);
    expect(opener).toHaveBeenCalledWith({ groupIndex: 1, channelIndex: 1 });
    hub.controller.selectChannel(Number.NaN, 0);
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('uses the attached screen until it detaches', async () => {
    const load = jest.fn(async () => []);
    const hub = createLiveControllerHub(load);
    const opener = jest.fn();
    hub.setLiveOpener(opener);
    const screen = { getGroups: () => groups, selectChannel: jest.fn() };
    const detach = hub.attachLiveScreen(screen);

    expect(await hub.controller.listGroups()).toHaveLength(2);
    expect(load).not.toHaveBeenCalled();
    hub.controller.selectChannel(1, 0);
    expect(screen.selectChannel).toHaveBeenCalledWith(1, 0);
    expect(opener).not.toHaveBeenCalled();

    detach();
    hub.controller.selectChannel(1, 0);
    expect(opener).toHaveBeenCalledWith({ groupIndex: 1, channelIndex: 0 });
  });

  it('ignores a stale detach after another screen attached', () => {
    const hub = createLiveControllerHub(async () => []);
    const first = { getGroups: () => groups, selectChannel: jest.fn() };
    const second = { getGroups: () => groups, selectChannel: jest.fn() };
    const detachFirst = hub.attachLiveScreen(first);
    hub.attachLiveScreen(second);
    detachFirst();
    hub.controller.selectChannel(1, 1);
    expect(second.selectChannel).toHaveBeenCalledWith(1, 1);
    expect(first.selectChannel).not.toHaveBeenCalled();
  });
});
