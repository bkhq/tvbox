import { act, create } from 'react-test-renderer';

import type { EngineEvent } from '../../../engine/types';
import { mpvEngineFactory } from '..';

jest.mock('../../../../../modules/mpv', () => ({
  isMpvAvailable: () => false,
  getMpvView: () => undefined,
}));

it('renders nothing and reports an init error when the native view is not linked', () => {
  const events: EngineEvent[] = [];
  const Component = mpvEngineFactory.Component;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <Component
        source={{ url: 'https://cdn/a.mkv', headers: {}, subtitles: [] }}
        paused={false}
        rate={1}
        resizeMode="contain"
        onEvent={(event) => events.push(event)}
      />,
    );
  });
  expect(renderer.toJSON()).toBeNull();
  expect(mpvEngineFactory.isAvailable()).toBe(false);
  expect(events).toEqual([
    { type: 'error', code: 'unavailable', message: 'mpv native module is not linked', fatal: true, phase: 'init', reason: 'init' },
  ]);
  act(() => renderer.unmount());
});
