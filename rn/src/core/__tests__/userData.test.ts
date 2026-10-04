import { MemoryStore } from '../storage';
import { getHistoryRepository, getKeepRepository, setUserDataStore } from '../userData';

describe('userData', () => {
  afterEach(() => setUserDataStore(undefined));

  it('returns the same repositories until the store is replaced', () => {
    const history = getHistoryRepository();
    const keep = getKeepRepository();
    expect(getHistoryRepository()).toBe(history);
    expect(getKeepRepository()).toBe(keep);

    setUserDataStore(new MemoryStore());
    expect(getHistoryRepository()).not.toBe(history);
    expect(getKeepRepository()).not.toBe(keep);
  });

  it('persists into the store set by the test hook', async () => {
    const store = new MemoryStore();
    setUserDataStore(store);
    await getHistoryRepository().upsert({ key: 'site@@@1', cid: 1, vodName: 'Movie' });
    await getKeepRepository().add({ key: 'site@@@1', cid: 1, siteName: 'Site', vodName: 'Movie', vodPic: '' });

    // Fresh singletons over the same store read the same data.
    setUserDataStore(store);
    expect((await getHistoryRepository().get(1, 'site@@@1'))?.vodName).toBe('Movie');
    expect(await getKeepRepository().isKept('site@@@1', 1)).toBe(true);

    setUserDataStore(new MemoryStore());
    expect(await getHistoryRepository().list(1)).toEqual([]);
  });
});
