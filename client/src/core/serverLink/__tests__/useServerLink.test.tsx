import { act, create } from 'react-test-renderer';

import { createConfigRepository, MemoryStore } from '../../storage';
import { createServerLink } from '../serverLink';
import { type UseServerLink, useServerLink } from '../useServerLink';

it('initialises the link and re-renders on state changes', async () => {
  const store = new MemoryStore();
  const fetch = jest.fn(async (url: string) => ({ ok: true, status: 200, url, text: async () => '{"status":"pending"}' }) as Response);
  const link = createServerLink({
    workerUrl: 'https://tvbox.example.workers.dev',
    versionName: '1.0.0',
    versionCode: 1,
    store,
    configs: createConfigRepository(store, 'vod'),
    loadConfig: async () => undefined,
    device: () => ({ name: '', model: '', mode: 'mobile', abi: '' }),
    fetch,
    timers: { setTimeout: () => 0, clearTimeout: () => undefined },
  });
  let result: UseServerLink | undefined;
  function Probe() {
    result = useServerLink(link);
    return null;
  }
  await act(async () => {
    create(<Probe />);
  });
  expect(result?.state).toBe('OFF');
  expect(result?.code).toMatch(/^.{4}-.{4}$/);

  await act(() => result!.request());
  expect(result?.state).toBe('PENDING');
  link.dispose();
});
