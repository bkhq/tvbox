import { createRef, type Ref } from 'react';
import { act, create } from 'react-test-renderer';

import type { MpvNativeEvent, MpvViewHandle, MpvViewProps } from '../../../../../modules/mpv';
import { clearEngines, getEngine } from '../../../engine/registry';
import type { EngineEvent, EngineHandle, EngineViewProps } from '../../../engine/types';
import { registerEngines } from '../..';
import { mpvEngineFactory } from '..';

const mockNative: {
  available: boolean;
  props?: MpvViewProps;
  seek: jest.Mock;
} = { available: true, seek: jest.fn(async () => undefined) };

jest.mock('../../../../../modules/mpv', () => {
  const { useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  function FakeMpvView({ ref, ...props }: MpvViewProps & { ref?: Ref<MpvViewHandle> }) {
    mockNative.props = props;
    useImperativeHandle(ref, () => ({ seek: mockNative.seek }), []);
    return null;
  }
  return {
    isMpvAvailable: () => mockNative.available,
    getMpvView: () => FakeMpvView,
  };
});

const source: EngineViewProps['source'] = {
  url: 'https://cdn/a.mkv',
  headers: {},
  subtitles: [],
};

function render(onEvent: (event: EngineEvent) => void, ref?: Ref<EngineHandle>) {
  const Component = mpvEngineFactory.Component;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <Component ref={ref} source={source} paused={false} rate={1} resizeMode="contain" selectedTextTrack={null} onEvent={onEvent} />,
    );
  });
  return renderer;
}

beforeEach(() => {
  mockNative.available = true;
  mockNative.props = undefined;
  mockNative.seek.mockClear();
});

it('describes itself as the mpv engine and registers through registerEngines', () => {
  clearEngines();
  expect(mpvEngineFactory.kind).toBe('mpv');
  expect(mpvEngineFactory.label).toBe('MPV');
  registerEngines();
  expect(getEngine('mpv')).toBe(mpvEngineFactory);
  clearEngines();
});

it('isAvailable follows the native module', () => {
  expect(mpvEngineFactory.isAvailable()).toBe(true);
  mockNative.available = false;
  expect(mpvEngineFactory.isAvailable()).toBe(false);
});

it('passes native props with the decode setting and maps native events', () => {
  const events: EngineEvent[] = [];
  const renderer = render((event) => events.push(event));
  expect(mockNative.props).toMatchObject({
    source: { url: 'https://cdn/a.mkv', startPosition: 0 },
    paused: false,
    speed: 1,
    subtitleTrack: 'no',
    audioTrack: 'auto',
    decode: 'hard',
  });
  const emit = (nativeEvent: MpvNativeEvent) => act(() => mockNative.props?.onMpvEvent?.({ nativeEvent }));
  emit({ type: 'loaded', duration: 5, tracks: [] });
  emit({ type: 'endFile', reason: 0, code: 0, message: 'success' });
  expect(events).toEqual([{ type: 'load', duration: 5000, tracks: { audio: [], text: [], video: [] } }, { type: 'ended' }]);
  act(() => renderer.unmount());
});

it('seeks through the native view ref in milliseconds', () => {
  const ref = createRef<EngineHandle>();
  const renderer = render(() => undefined, ref);
  ref.current?.seek(42_000);
  expect(mockNative.seek).toHaveBeenCalledWith(42_000);
  act(() => renderer.unmount());
});
