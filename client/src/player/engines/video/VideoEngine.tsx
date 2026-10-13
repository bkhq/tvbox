import { useImperativeHandle, useMemo, useRef } from 'react';
import { NativeModules, UIManager } from 'react-native';
import Video, { type OnLoadData, type VideoRef } from 'react-native-video';

import type { EngineFactory, EngineHandle, EngineTracks, EngineViewProps } from '../../engine/types';
import { toEngineError } from './errors';
import {
  toAudioTracks,
  toSelectedTrack,
  toTextTrackList,
  toVideoResizeMode,
  toVideoSource,
  toVideoSize,
  toVideoTracks,
} from './mapping';

/**
 * The "系统播放器" engine: react-native-video, which is Media3 (ExoPlayer) on
 * Android and AVPlayer on iOS / tvOS. Mirrors player/exo/ExoPlayerEngine.java.
 */

const seconds = (value: number) => Math.round(value * 1000);

export function VideoEngineView({
  ref,
  source,
  paused,
  rate,
  resizeMode,
  selectedAudioTrack,
  selectedTextTrack,
  style,
  background = false,
  onEvent,
}: EngineViewProps & { ref?: React.Ref<EngineHandle> }) {
  const video = useRef<VideoRef>(null);
  const loaded = useRef(false);
  const duration = useRef(0);
  const tracks = useRef<EngineTracks>({ audio: [], text: [], video: [] });
  const videoSource = useMemo(() => toVideoSource(source), [source]);

  useImperativeHandle(ref, () => ({ seek: (ms: number) => video.current?.seek(ms / 1000) }), []);

  const updateTracks = (next: Partial<EngineTracks>) => {
    tracks.current = { ...tracks.current, ...next };
    onEvent({ type: 'tracks', ...tracks.current });
  };

  const onLoad = (data: OnLoadData) => {
    loaded.current = true;
    duration.current = seconds(data.duration);
    tracks.current = {
      audio: toAudioTracks(data.audioTracks),
      text: toTextTrackList(data.textTracks),
      video: toVideoTracks(data.videoTracks),
    };
    onEvent({ type: 'load', duration: duration.current, tracks: tracks.current, ...toVideoSize(data.naturalSize) });
  };

  return (
    <Video
      ref={video}
      source={videoSource}
      style={style}
      paused={paused}
      rate={rate}
      resizeMode={toVideoResizeMode(resizeMode)}
      selectedAudioTrack={toSelectedTrack(selectedAudioTrack)}
      selectedTextTrack={toSelectedTrack(selectedTextTrack)}
      playInBackground={background}
      playWhenInactive={background}
      ignoreSilentSwitch="ignore"
      onLoad={onLoad}
      onProgress={(data) =>
        onEvent({
          type: 'progress',
          position: seconds(data.currentTime),
          duration: duration.current || seconds(data.seekableDuration),
          buffered: seconds(data.playableDuration),
        })
      }
      onBuffer={(data) => onEvent({ type: 'buffering', value: data.isBuffering })}
      onPlaybackStateChanged={(data) => {
        // isPlaying also becomes false during buffering and seeks.
        if (data.isPlaying && !paused) onEvent({ type: 'playing' });
        else if (!data.isPlaying && paused) onEvent({ type: 'paused' });
      }}
      onEnd={() => onEvent({ type: 'ended' })}
      onError={(data) => onEvent({ type: 'error', ...toEngineError(data.error, loaded.current) })}
      onAudioTracks={(data) => updateTracks({ audio: toAudioTracks(data.audioTracks) })}
      onTextTracks={(data) => updateTracks({ text: toTextTrackList(data.textTracks) })}
    />
  );
}

/** True when the native RCTVideo view is linked into the app. */
export function isVideoEngineAvailable(): boolean {
  try {
    return UIManager.hasViewManagerConfig('RCTVideo') || NativeModules.VideoManager != null;
  } catch {
    return false;
  }
}

export const videoEngineFactory: EngineFactory = {
  kind: 'video',
  label: '系统播放器',
  isAvailable: isVideoEngineAvailable,
  Component: VideoEngineView,
};
