import { createKeepRepository } from '../../../core/storage/keep';
import { MemoryStore } from '../../../core/storage/keyValueStore';
import type { Group } from '../../../core/types';
import { emptyChannel } from '../../../player/live/channel';
import { isFavourite, toggleFavourite } from '../liveFavourites';

const channel = (name: string, url = 'http://x/' + name) => ({ ...emptyChannel(name), urls: [url] });

function makeGroups(): Group[] {
  return [
    { name: '收藏', pass: '', channel: [] },
    { name: '央视', pass: '', channel: [{ ...channel('CCTV1', 'http://a'), logo: 'http://logo' }, channel('CCTV2')] },
    { name: '高清', pass: '', channel: [channel('CCTV1', 'http://b')] },
  ];
}

describe('toggleFavourite', () => {
  it('adds a live keep and a copy to the keep group without mutating the input', async () => {
    const repo = createKeepRepository(new MemoryStore(), () => 1);
    const groups = makeGroups();
    const snapshot = JSON.stringify(groups);
    const target = groups[1]!.channel[0]!;

    expect(isFavourite(groups, target)).toBe(false);
    const result = await toggleFavourite(groups, target, repo);

    expect(result.favourite).toBe(true);
    expect(JSON.stringify(groups)).toBe(snapshot);
    expect(result.groups).not.toBe(groups);
    expect(result.groups[1]).toBe(groups[1]);
    const kept = result.groups[0]!.channel;
    expect(kept.map((item) => item.name)).toEqual(['CCTV1']);
    expect(kept[0]!.urls).toEqual(['http://a', 'http://b']);
    expect(kept[0]).not.toBe(target);
    expect(isFavourite(result.groups, target)).toBe(true);
    expect(await repo.list(0, 1)).toEqual([
      { type: 1, cid: 0, key: 'CCTV1', vodName: 'CCTV1', vodPic: 'http://logo', siteName: '', createTime: 1 },
    ]);
  });

  it('removes the keep and leaves an empty keep group', async () => {
    const repo = createKeepRepository(new MemoryStore());
    const added = await toggleFavourite(makeGroups(), makeGroups()[1]!.channel[0]!, repo);
    const before = JSON.stringify(added.groups);

    const removed = await toggleFavourite(added.groups, added.groups[0]!.channel[0]!, repo);

    expect(removed.favourite).toBe(false);
    expect(JSON.stringify(added.groups)).toBe(before);
    expect(removed.groups[0]).toEqual({ name: '收藏', pass: '', channel: [] });
    expect(removed.groups).toHaveLength(3);
    expect(await repo.list(0, 1)).toEqual([]);
  });
});
