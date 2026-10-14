import { useState } from 'react';
import { Text } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { selectHome } from '../../core/config';
import { getProvider, UnsupportedSiteError } from '../../core/provider';
import { useSetting } from '../../core/settings';
import type { Vod } from '../../core/types';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { color, PosterCard, Row, safeArea, scaledText, space, useScaledStyles, type Scaler } from '../../ui';
import { displayRemarks, openVod } from '../common';

type SimilarState =
  | { status: 'idle' | 'loading' | 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; siteKey: string; list: Vod[] };

/**
 * Search results for the vod name on the home site; `load` starts the search once.
 * The vod itself is left out when the home site is its own site.
 */
export function useSimilar(siteKey: string, vod: Vod): [SimilarState, () => void] {
  const { config } = useVodConfig();
  const [homeSiteKey] = useSetting('homeSiteKey');
  const [state, setState] = useState<SimilarState>({ status: 'idle' });

  const load = () => {
    if (state.status !== 'idle') return;
    const home = config && selectHome(config.sites, homeSiteKey || config.home?.key);
    let provider;
    try {
      provider = home && getProvider(home);
    } catch (error) {
      if (!(error instanceof UnsupportedSiteError)) throw error;
    }
    if (!home || !provider) {
      setState({ status: 'empty' });
      return;
    }
    setState({ status: 'loading' });
    provider.search(vod.vod_name, false).then(
      (result) => {
        const list = result.list.filter((item) => !(home.key === siteKey && item.vod_id === vod.vod_id));
        setState(list.length > 0 ? { status: 'ready', siteKey: home.key, list } : { status: 'empty' });
      },
      (error: unknown) =>
        setState({ status: 'error', message: `加载失败：${error instanceof Error ? error.message : String(error)}` }),
    );
  };

  return [state, load];
}

export function SimilarRow({ state }: { state: SimilarState }) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  if (state.status === 'ready') {
    return (
      <Row
        testID="detail-similar"
        data={state.list}
        keyExtractor={(item, index) => `${index}-${item.vod_id}`}
        renderItem={({ item, index }) => (
          <PosterCard
            testID={`detail-similar-${index}`}
            title={item.vod_name}
            meta={item.vod_year || displayRemarks(item.vod_remarks)}
            poster={item.vod_pic}
            onPress={() => openVod(navigation, state.siteKey, item)}
          />
        )}
      />
    );
  }
  const message = state.status === 'error' ? state.message : state.status === 'empty' ? '暂无相似推荐' : '正在加载…';
  return (
    <Text testID="detail-similar-status" style={styles.status}>
      {message}
    </Text>
  );
}

const makeStyles = (s: Scaler) => ({
  status: {
    ...scaledText(s).body,
    color: color.text2,
    paddingHorizontal: s(safeArea.horizontal),
    paddingVertical: s(space.lg),
  },
});
