import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet } from 'react-native';

import { getMpvView, type MpvNativeEvent, type MpvViewHandle } from '../../../../modules/mpv';
import { useSetting } from '../../../core/settings';
import type { EngineHandle, EngineViewProps } from '../../engine/types';
import { createMpvEventMapper, toNativeProps } from './mapping';

const NativeMpvView = getMpvView();

/**
 * The mpv engine view: EngineViewProps -> native mpv props, native events -> EngineEvent.
 * The player remounts engine views per source, so the event mapper lives for one mount.
 */
export function MpvEngineView({ ref, style, onEvent, ...props }: EngineViewProps & { ref?: Ref<EngineHandle> }) {
  const [decode] = useSetting('decode');
  const native = useRef<MpvViewHandle>(null);
  const [mapEvent] = useState(() => createMpvEventMapper(props.source.url));

  const onMpvEvent = ({ nativeEvent }: { nativeEvent: MpvNativeEvent }) => {
    for (const event of mapEvent(nativeEvent)) onEvent(event);
  };

  useImperativeHandle(
    ref,
    () => ({
      seek: (ms: number) => {
        native.current?.seek(ms).catch(() => undefined);
      },
    }),
    [],
  );

  useEffect(() => {
    if (NativeMpvView) return;
    for (const event of mapEvent({ type: 'error', phase: 'init', code: 'unavailable', message: 'mpv native module is not linked' })) {
      onEvent(event);
    }
  }, [mapEvent, onEvent]);

  if (!NativeMpvView) return null;
  return <NativeMpvView ref={native} style={[styles.fill, style]} {...toNativeProps(props, decode)} onMpvEvent={onMpvEvent} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});
