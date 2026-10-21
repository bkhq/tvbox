import { LanCatalogError } from '../ports';
import { bodyJson, fakeCatalog, setup } from '../__fixtures__/fakes';

const navigator = () => ({ search: jest.fn(), play: jest.fn() });

// The idle timer of a started search would otherwise keep Jest alive.
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('/api/search', () => {
  it('starts a search and answers the first snapshot with an id', async () => {
    const { catalog, snapshot } = fakeCatalog({ total: 3 });
    const { call } = await setup({ ports: { catalog } });
    const res = await call('/api/search', { word: '三体' });
    expect(res.status).toBe(200);
    expect(bodyJson(res)).toEqual({ id: 1, keyword: '三体', quick: false, ...snapshot });
    expect(catalog.search).toHaveBeenCalledWith('三体', false);
    expect(bodyJson(await call('/api/search', { word: '三体', quick: 'true' })).quick).toBe(true);
    expect(catalog.search).toHaveBeenLastCalledWith('三体', true);
  });

  it('polls the current search by id and cancels it when a new one starts', async () => {
    const { catalog, session, snapshot } = fakeCatalog();
    const { call } = await setup({ ports: { catalog } });
    await call('/api/search', { word: 'a' });
    snapshot.completed = 2;
    snapshot.done = true;
    expect(bodyJson(await call('/api/search', { id: '1' }))).toEqual({ id: 1, keyword: 'a', quick: false, ...snapshot });
    await call('/api/search', { word: 'b' });
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(await call('/api/search', { id: '1' })).toMatchObject({ status: 404, body: 'search not found' });
    expect(bodyJson(await call('/api/search', { id: '2' })).keyword).toBe('b');
  });

  it('drops a search that nobody polls for a minute', async () => {
    const { catalog, session } = fakeCatalog();
    const { call } = await setup({ ports: { catalog } });
    await call('/api/search', { word: 'a' });
    jest.advanceTimersByTime(59_000);
    await call('/api/search', { id: '1' });
    jest.advanceTimersByTime(59_000);
    expect(session.cancel).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2_000);
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect((await call('/api/search', { id: '1' })).status).toBe(404);
  });

  it('answers the search words without parameters', async () => {
    const { catalog } = fakeCatalog();
    const { call } = await setup({ ports: { catalog } });
    expect(bodyJson(await call('/api/search'))).toEqual({ history: ['繁花'], hot: ['三体'] });
  });

  it('opens the search on the TV with do=open', async () => {
    const nav = navigator();
    const { catalog } = fakeCatalog();
    const { call } = await setup({ ports: { catalog, navigator: nav } });
    expect((await call('/api/search', { word: '三体', do: 'open' })).status).toBe(200);
    expect(nav.search).toHaveBeenCalledWith('三体');
    expect(catalog.search).not.toHaveBeenCalled();
    expect(await call('/api/search', { do: 'open' })).toMatchObject({ status: 400, body: 'word required' });
  });

  it('requires the catalog port', async () => {
    const { call } = await setup();
    expect(await call('/api/search', { word: 'a' })).toMatchObject({ status: 400, body: 'catalog not available' });
  });
});

describe('/api/detail', () => {
  it('answers the detail of a site vod', async () => {
    const { catalog } = fakeCatalog();
    const { call } = await setup({ ports: { catalog } });
    const res = await call('/api/detail', { site: 'a', id: 'v1' });
    expect(res.status).toBe(200);
    expect(bodyJson(res)).toMatchObject({ site: { key: 'a' }, vod: { id: 'v1', name: 'Movie' }, flags: [{ flag: 'line1' }, { flag: 'line2' }] });
    expect(catalog.detail).toHaveBeenCalledWith('a', 'v1');
  });

  it('maps catalog errors to their status', async () => {
    const { catalog } = fakeCatalog();
    catalog.detail.mockRejectedValueOnce(new LanCatalogError(404, 'site not found'));
    const { call } = await setup({ ports: { catalog } });
    expect(await call('/api/detail', { site: 'x', id: 'v1' })).toMatchObject({ status: 404, body: 'site not found' });
    expect(await call('/api/detail', { site: 'a' })).toMatchObject({ status: 400, body: 'site and id required' });
  });
});

describe('/api/play', () => {
  it('plays the given episode', async () => {
    const nav = navigator();
    const { catalog } = fakeCatalog();
    const { call } = await setup({ ports: { catalog, navigator: nav } });
    expect(await call('/api/play', { site: 'a', id: 'v1', flag: 'line2', url: 'f1', position: '5000' })).toMatchObject({ status: 200, body: 'OK' });
    expect(nav.play).toHaveBeenCalledWith({ siteKey: 'a', vodId: 'v1', flag: 'line2', episodeUrl: 'f1', position: 5000 });
    expect(catalog.detail).not.toHaveBeenCalled();
  });

  it('resumes from the history or starts the first episode', async () => {
    const nav = navigator();
    const { catalog } = fakeCatalog();
    const { call } = await setup({ ports: { catalog, navigator: nav } });
    expect((await call('/api/play', { site: 'a', id: 'v1' })).status).toBe(200);
    expect(nav.play).toHaveBeenLastCalledWith({ siteKey: 'a', vodId: 'v1', flag: 'line1', episodeUrl: 'e1' });
    catalog.detail.mockResolvedValueOnce({ ...(await catalog.detail()), resume: { flag: 'line1', episodeUrl: 'e2', position: 60_000, duration: 100_000 } });
    expect((await call('/api/play', { site: 'a', id: 'v1' })).status).toBe(200);
    expect(nav.play).toHaveBeenLastCalledWith({ siteKey: 'a', vodId: 'v1', flag: 'line1', episodeUrl: 'e2', position: 60_000 });
  });

  it('rejects vods without episodes and missing parameters', async () => {
    const nav = navigator();
    const { catalog } = fakeCatalog();
    catalog.detail.mockResolvedValueOnce({ ...(await catalog.detail()), flags: [] });
    const { call } = await setup({ ports: { catalog, navigator: nav } });
    expect(await call('/api/play', { site: 'a', id: 'v1' })).toMatchObject({ status: 404, body: 'no episodes' });
    expect(await call('/api/play', { site: 'a' })).toMatchObject({ status: 400, body: 'site and id required' });
    expect(nav.play).not.toHaveBeenCalled();
    expect(await (await setup({ ports: { catalog } })).call('/api/play', { site: 'a', id: 'v1', flag: 'l', url: 'u' })).toMatchObject({ status: 400, body: 'navigator not available' });
  });
});

describe('/api/library', () => {
  it('lists the history and favourites', async () => {
    const { catalog } = fakeCatalog();
    const item = { siteKey: 'a', siteName: 'Site a', id: 'v1', name: 'Movie', pic: '', remarks: '第2集', year: '', type: '', flag: 'line1', episodeUrl: 'e2', position: 1000, duration: 2000, time: 5 };
    catalog.history.mockResolvedValueOnce([item]);
    const { call } = await setup({ ports: { catalog } });
    expect(bodyJson(await call('/api/library'))).toEqual({ history: [item], keeps: [] });
    expect(await (await setup()).call('/api/library')).toMatchObject({ status: 400, body: 'catalog not available' });
  });
});
