import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { getProvider, type SiteProvider, UnsupportedSiteError } from '../../core/provider';
import { historyKey } from '../../core/storage';
import { type Episode, type History, parseFlags, type Site, type Vod } from '../../core/types';
import { getHistoryRepository, getKeepRepository } from '../../core/userData';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RootStackScreenProps } from '../../navigation/types';
import { colors, FocusableButton, fontSize, HorizontalRow, radius, spacing, useLayout } from '../../ui';
import { ErrorView, LoadingView, useActiveCid, useSite } from '../common';
import { buildHistoryInput, buildPlayerParams, resolveResume, sortEpisodes } from './detailState';

type DetailParams = RootStackScreenProps<'Detail'>['route']['params'];

/** Route label plus vod name; TV screens have no navigation header. */
function Header({ vodName, children }: { vodName?: string; children?: ReactNode }) {
  return (
    <View style={styles.header}>
      <Text style={styles.label}>详情</Text>
      <Text style={styles.title} numberOfLines={1}>
        {vodName ?? ''}
      </Text>
      {children}
    </View>
  );
}

function Poster({ uri }: { uri?: string }) {
  const { isTV } = useLayout();
  return (
    <View style={[styles.poster, isTV && styles.posterTV]}>
      {uri ? <Image source={{ uri }} style={styles.posterImage} resizeMode="cover" /> : null}
    </View>
  );
}

function Info({ vod }: { vod: Vod }) {
  const { isPhone } = useLayout();
  const [expanded, setExpanded] = useState(false);
  const meta = [vod.type_name, vod.vod_year, vod.vod_area, vod.vod_remarks].filter(Boolean).join(' / ');
  const content = vod.vod_content.trim();
  return (
    <View style={styles.info}>
      <Text style={styles.name}>{vod.vod_name}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {vod.vod_director ? <Text style={styles.meta}>{`导演：${vod.vod_director}`}</Text> : null}
      {vod.vod_actor ? (
        <Text style={styles.meta} numberOfLines={2}>
          {`演员：${vod.vod_actor}`}
        </Text>
      ) : null}
      {content && isPhone ? (
        <Pressable testID="detail-content" accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
          <Text style={styles.content} numberOfLines={expanded ? undefined : 3}>
            {content}
          </Text>
          <Text style={styles.more}>{expanded ? '收起' : '展开'}</Text>
        </Pressable>
      ) : null}
      {content && !isPhone ? (
        <Text style={styles.content} numberOfLines={4}>
          {content}
        </Text>
      ) : null}
    </View>
  );
}

function DetailBody({
  site,
  siteKey,
  vodId,
  vod,
  initialHistory,
}: {
  site: Site;
  siteKey: string;
  vodId: string;
  vod: Vod;
  initialHistory?: History;
}) {
  const navigation = useAppNavigation();
  const cid = useActiveCid();
  const key = historyKey(siteKey, vodId);
  const flags = useMemo(() => parseFlags(vod), [vod]);
  const [initial] = useState(() => resolveResume(flags, initialHistory));
  const [history, setHistory] = useState(initialHistory);
  const [flagIndex, setFlagIndex] = useState(initial.flagIndex);
  const [revSort, setRevSort] = useState(initial.revSort);
  const [current, setCurrent] = useState(
    initial.episode ? { flag: flags[initial.flagIndex]!.flag, url: initial.episode.url } : undefined,
  );
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (cid === undefined) return;
    let active = true;
    void getKeepRepository()
      .isKept(key, cid)
      .then((value) => active && setKept(value));
    return () => {
      active = false;
    };
  }, [cid, key]);

  // The player saves progress and may move to another episode; pick that up when the screen regains focus.
  useEffect(() => {
    if (cid === undefined) return;
    return navigation.addListener('focus', () => {
      void getHistoryRepository()
        .get(cid, key)
        .then((record) => {
          if (!record) return;
          setHistory(record);
          const target = resolveResume(flags, record);
          if (!target.episode) return;
          setFlagIndex(target.flagIndex);
          setCurrent({
            flag: flags[target.flagIndex]!.flag,
            url: target.episode.url,
          });
        });
    });
  }, [navigation, cid, key, flags]);

  const flag = flags[flagIndex];
  const episodes = useMemo(() => sortEpisodes(flag?.episodes ?? [], revSort), [flag, revSort]);
  const resume = useMemo(() => resolveResume(flags, history), [flags, history]);
  const resumeEpisode = resume.episode;
  const resumeFlag = flags[resume.flagIndex]?.flag;

  const play = useCallback(
    async (flagName: string, episode: Episode) => {
      setCurrent({ flag: flagName, url: episode.url });
      let position: number | undefined;
      if (cid !== undefined) {
        const repository = getHistoryRepository();
        const existing = await repository.get(cid, key);
        const record = await repository.upsert(
          buildHistoryInput({
            key,
            cid,
            vod,
            flag: flagName,
            episode,
            revSort,
            existing,
          }),
        );
        setHistory(record);
        position = record.position;
      }
      navigation.navigate('Player', buildPlayerParams(siteKey, vodId, flagName, episode, position));
    },
    [cid, key, vod, revSort, navigation, siteKey, vodId],
  );

  const toggleSort = () => {
    const next = !revSort;
    setRevSort(next);
    // Only an existing record is updated; a new one is written on the first play.
    if (cid !== undefined && history) void getHistoryRepository().upsert({ key, cid, revSort: next }).then(setHistory);
  };

  const toggleKeep = async () => {
    if (cid === undefined) return;
    const repository = getKeepRepository();
    if (kept) await repository.remove(key, cid);
    else
      await repository.add({
        key,
        cid,
        siteName: site.name,
        vodName: vod.vod_name,
        vodPic: vod.vod_pic,
      });
    setKept(!kept);
  };

  const firstEpisode = episodes[0];
  const hasPlay = resumeEpisode !== undefined || (flag !== undefined && firstEpisode !== undefined);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} testID="detail-body">
      <Header vodName={vod.vod_name} />
      <View style={styles.top}>
        <Poster uri={vod.vod_pic} />
        <Info vod={vod} />
      </View>
      <View style={styles.actions}>
        {resumeEpisode && resumeFlag !== undefined ? (
          <FocusableButton
            testID="detail-resume"
            title={`继续播放 ${resumeEpisode.name}`}
            selected
            hasTVPreferredFocus
            onPress={() => void play(resumeFlag, resumeEpisode)}
          />
        ) : flag && firstEpisode ? (
          <FocusableButton
            testID="detail-play"
            title="播放"
            selected
            hasTVPreferredFocus
            onPress={() => void play(flag.flag, firstEpisode)}
          />
        ) : null}
        <FocusableButton
          testID="detail-collect"
          title={kept ? '已收藏' : '收藏'}
          selected={kept}
          disabled={cid === undefined}
          hasTVPreferredFocus={!hasPlay}
          onPress={() => void toggleKeep()}
        />
      </View>
      {flags.length > 0 ? (
        <HorizontalRow
          testID="detail-flags"
          title="线路"
          data={flags}
          keyExtractor={(item, index) => `${index}-${item.flag}`}
          renderItem={({ item, index }) => (
            <FocusableButton
              testID={`detail-flag-${index}`}
              title={item.flag}
              selected={index === flagIndex}
              onPress={() => setFlagIndex(index)}
            />
          )}
        />
      ) : (
        <Text style={styles.empty}>暂无播放源</Text>
      )}
      {flag ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>选集</Text>
            <FocusableButton testID="detail-sort" title="倒序" selected={revSort} onPress={toggleSort} />
          </View>
          <View style={styles.episodes} testID="detail-episodes">
            {episodes.map((episode, index) => (
              <FocusableButton
                key={`${index}-${episode.url}`}
                testID={`detail-episode-${index}`}
                title={episode.name}
                selected={current?.flag === flag.flag && current.url === episode.url}
                style={styles.episode}
                onPress={() => void play(flag.flag, episode)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

type LoadState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; vod: Vod; history?: History };

function DetailContent({ provider, site, params }: { provider: SiteProvider; site: Site; params: DetailParams }) {
  const { siteKey, vodId, vodName, vodPic } = params;
  const cid = useActiveCid();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // SiteViewModel.detailContent: the first list item is the vod.
  useEffect(() => {
    let active = true;
    const history =
      cid === undefined ? Promise.resolve(undefined) : getHistoryRepository().get(cid, historyKey(siteKey, vodId));
    Promise.all([provider.detail([vodId]), history.catch(() => undefined)]).then(
      ([result, record]) => {
        if (!active) return;
        const vod = result.list[0];
        setState(vod ? { status: 'ready', vod, history: record } : { status: 'error', message: '未找到影片' });
      },
      (error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: `加载失败：${error instanceof Error ? error.message : String(error)}`,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [provider, siteKey, vodId, cid, attempt]);

  if (state.status === 'ready') {
    return <DetailBody site={site} siteKey={siteKey} vodId={vodId} vod={state.vod} initialHistory={state.history} />;
  }
  return (
    <View style={styles.container}>
      <Header vodName={vodName} />
      <View style={styles.top}>
        <Poster uri={vodPic} />
      </View>
      {state.status === 'loading' ? (
        <LoadingView />
      ) : (
        <ErrorView
          testID="detail-error"
          message={state.message}
          onRetry={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
          hasTVPreferredFocus
        />
      )}
    </View>
  );
}

export default function DetailScreen({ route }: RootStackScreenProps<'Detail'>) {
  const { siteKey, vodName } = route.params;
  const { status } = useVodConfig();
  const cid = useActiveCid();
  const site = useSite(siteKey);
  const provider = useMemo(() => {
    if (!site) return undefined;
    try {
      return getProvider(site);
    } catch (error) {
      if (error instanceof UnsupportedSiteError) return undefined;
      throw error;
    }
  }, [site]);

  // Remount per vod and config so the load and the resume selection start over.
  if (site && provider) {
    return (
      <DetailContent
        key={`${siteKey}/${route.params.vodId}/${cid ?? ''}`}
        provider={provider}
        site={site}
        params={route.params}
      />
    );
  }
  return (
    <View style={styles.container}>
      <Header vodName={vodName} />
      {status === 'loading' ? <LoadingView /> : <ErrorView testID="detail-unavailable" message="站点不可用" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  label: {
    marginRight: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  top: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  poster: {
    width: 120,
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  posterTV: {
    width: 180,
  },
  posterImage: {
    ...StyleSheet.absoluteFill,
  },
  info: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  name: {
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: fontSize.display,
    fontWeight: '600',
  },
  meta: {
    marginBottom: spacing.xs,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  content: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: fontSize.body,
  },
  more: {
    color: colors.primary,
    fontSize: fontSize.caption,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  section: {
    paddingHorizontal: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.title,
    fontWeight: '600',
  },
  episodes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  episode: {
    minWidth: 96,
  },
  empty: {
    marginVertical: spacing.xl,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    textAlign: 'center',
  },
});
