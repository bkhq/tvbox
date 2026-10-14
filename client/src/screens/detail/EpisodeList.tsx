import { View } from 'react-native';

import type { Episode, History } from '../../core/types';
import { Badge, Row, useScaledStyles, WideCard, type Scaler } from '../../ui';
import { episodeProgress } from './detailState';

export interface EpisodeListProps {
  flag: string;
  /** Episodes in display order. */
  episodes: readonly Episode[];
  /** The episodes are the flag's list reversed; the number badge keeps the original order. */
  reversed: boolean;
  image?: string;
  history?: History;
  /** Url of the current episode of this flag. */
  currentUrl?: string;
  onPlay: (episode: Episode) => void;
}

/** Episodes of one play line as a row of wide cards. */
export function EpisodeList({ flag, episodes, reversed, image, history, currentUrl, onPlay }: EpisodeListProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <Row
      testID="detail-episodes"
      data={episodes}
      keyExtractor={(episode, index) => `${index}-${episode.url}`}
      renderItem={({ item, index }) => (
        <View>
          <WideCard
            testID={`detail-episode-${index}`}
            title={item.name}
            image={image}
            progress={episodeProgress(history, flag, item)}
            onPress={() => onPlay(item)}
          />
          <View pointerEvents="none" style={styles.number}>
            <Badge
              label={String(reversed ? episodes.length - index : index + 1)}
              style={[styles.shade, styles.plain]}
            />
          </View>
          {item.url === currentUrl ? (
            <View pointerEvents="none" style={styles.current}>
              <Badge testID={`detail-episode-${index}-current`} label="当前" variant="accent" style={styles.shade} />
            </View>
          ) : null}
        </View>
      )}
    />
  );
}

const makeStyles = (s: Scaler) => ({
  number: { position: 'absolute' as const, top: s(12), left: s(12) },
  current: { position: 'absolute' as const, top: s(12), right: s(12) },
  shade: { backgroundColor: 'rgba(11,14,20,0.7)' },
  plain: { borderWidth: 0 },
});
