import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { getProvider, type SiteProvider, UnsupportedSiteError } from '../../core/provider';
import { historyKey } from '../../core/storage';
import { type Episode, type History, parseFlags, type Site, type Vod } from '../../core/types';
import { getHistoryRepository, getKeepRepository } from '../../core/userData';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RootStackScreenProps } from '../../navigation/types';
import {
  BackButton,
  Badge,
  Button,
  Chip,
  color,
  Icon,
  safeArea,
  scaledText,
  space,
  Tab,
  useLayout,
  useScaledStyles,
  type Scaler,
} from '../../ui';
import { ErrorView, htmlToText, LoadingView, useActiveCid, useSite } from '../common';
import { Backdrop } from './Backdrop';
import { buildHistoryInput, buildPlayerParams, resolveResume, sortEpisodes, splitPeople, tagLine } from './detailState';
import { EpisodeList } from './EpisodeList';
import { FlagPicker } from './FlagPicker';
import { SimilarRow, useSimilar } from './Similar';

type DetailParams = RootStackScreenProps<'Detail'>['route']['params'];

type DetailTab = 'episodes' | 'similar' | 'cast';

/** Page frame: background, optional backdrop and the back pill. */
function Page({
  pic,
  backFocus,
  children,
  testID,
}: {
  pic?: string;
  backFocus?: boolean;
  children: ReactNode;
  testID?: string;
}) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.scroll} testID={testID}>
      <Backdrop uri={pic} />
      <BackButton
        testID="detail-back"
        hasTVPreferredFocus={backFocus}
        style={styles.back}
        onPress={() => navigation.goBack()}
      />
      {children}
    </ScrollView>
  );
}

function Info({ vod }: { vod: Vod }) {
  const { isPhone } = useLayout();
  const styles = useScaledStyles(makeStyles);
  const [expanded, setExpanded] = useState(false);
  const tags = tagLine(vod);
  const content = useMemo(() => htmlToText(vod.vod_content), [vod.vod_content]);
  const long = [...vod.vod_name].length > 8;
  return (
    <View style={styles.info}>
      {vod.vod_remarks || tags ? (
        <View style={styles.tagLine}>
          {vod.vod_remarks ? <Badge testID="detail-remarks" label={vod.vod_remarks} variant="accent" /> : null}
          {tags ? <Text style={styles.tags}>{tags}</Text> : null}
        </View>
      ) : null}
      <Text numberOfLines={1} style={long ? styles.titleSm : styles.title}>
        {vod.vod_name}
      </Text>
      {vod.vod_score ? (
        <View style={styles.meta} testID="detail-score">
          <Icon name="star" size={26} color={color.accent} />
          <Text style={styles.score}>{vod.vod_score}</Text>
        </View>
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
        <Text style={styles.content} numberOfLines={3}>
          {content}
        </Text>
      ) : null}
      {vod.vod_director || vod.vod_actor ? (
        <View style={styles.people}>
          {vod.vod_director ? <Person label="导演" value={vod.vod_director} /> : null}
          {vod.vod_actor ? <Person label="主演" value={vod.vod_actor} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Person({ label, value }: { label: string; value: string }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.person}>
      <Text style={styles.personLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.personValue}>
        {value}
      </Text>
    </View>
  );
}

function Cast({ vod }: { vod: Vod }) {
  const styles = useScaledStyles(makeStyles);
  const groups = [
    { label: '导演', names: splitPeople(vod.vod_director) },
    { label: '主演', names: splitPeople(vod.vod_actor) },
  ].filter((group) => group.names.length > 0);
  return (
    <View style={styles.cast} testID="detail-cast">
      {groups.map((group) => (
        <View key={group.label} style={styles.castGroup}>
          <Text style={styles.personLabel}>{group.label}</Text>
          <View style={styles.castNames}>
            {group.names.map((name, index) => (
              <Chip key={`${index}-${name}`} label={name} />
            ))}
          </View>
        </View>
      ))}
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
  const styles = useScaledStyles(makeStyles);
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
  const [tab, setTab] = useState<DetailTab>('episodes');
  const [similar, loadSimilar] = useSimilar(siteKey, vod);
  const hasCast = Boolean(vod.vod_actor || vod.vod_director);

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
          setCurrent({ flag: flags[target.flagIndex]!.flag, url: target.episode.url });
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
          buildHistoryInput({ key, cid, vod, flag: flagName, episode, revSort, existing }),
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
    else await repository.add({ key, cid, siteName: site.name, vodName: vod.vod_name, vodPic: vod.vod_pic });
    setKept(!kept);
  };

  // The first episode of the current flag in its original order.
  const firstEpisode = flag?.episodes[0];
  const hasPlay = resumeEpisode !== undefined || (flag !== undefined && firstEpisode !== undefined);

  return (
    <Page pic={vod.vod_pic} testID="detail-body">
      <Info vod={vod} />
      <View style={styles.actions}>
        {resumeEpisode && resumeFlag !== undefined ? (
          <Button
            testID="detail-resume"
            variant="primary"
            icon="play"
            title={`继续播放 · ${resumeEpisode.name}`}
            hasTVPreferredFocus
            onPress={() => void play(resumeFlag, resumeEpisode)}
          />
        ) : flag && firstEpisode ? (
          <Button
            testID="detail-play"
            variant="primary"
            icon="play"
            title="立即播放"
            hasTVPreferredFocus
            onPress={() => void play(flag.flag, firstEpisode)}
          />
        ) : null}
        <Button
          testID="detail-collect"
          icon={kept ? 'check' : 'plus'}
          title={kept ? '已在片单' : '片单'}
          disabled={cid === undefined}
          hasTVPreferredFocus={!hasPlay}
          onPress={() => void toggleKeep()}
        />
      </View>
      <View style={styles.tabBar}>
        <View style={styles.tabs}>
          <Tab
            testID="detail-tab-episodes"
            label="剧集"
            active={tab === 'episodes'}
            onPress={() => setTab('episodes')}
          />
          <Tab
            testID="detail-tab-similar"
            label="相似推荐"
            active={tab === 'similar'}
            onPress={() => {
              setTab('similar');
              loadSimilar();
            }}
          />
          {hasCast ? (
            <Tab testID="detail-tab-cast" label="演职员" active={tab === 'cast'} onPress={() => setTab('cast')} />
          ) : null}
        </View>
        {tab === 'episodes' && flag ? (
          <View style={styles.tabTools}>
            <FlagPicker flags={flags} flagIndex={flagIndex} onSelect={setFlagIndex} />
            <Chip testID="detail-sort" label="倒序" selected={revSort} onPress={toggleSort} />
          </View>
        ) : null}
      </View>
      {tab === 'episodes' ? (
        flag ? (
          <EpisodeList
            flag={flag.flag}
            episodes={episodes}
            reversed={revSort}
            image={vod.vod_pic}
            history={history}
            currentUrl={current?.flag === flag.flag ? current.url : undefined}
            onPlay={(episode) => void play(flag.flag, episode)}
          />
        ) : (
          <Text style={styles.empty}>暂无播放源</Text>
        )
      ) : null}
      {tab === 'similar' ? <SimilarRow state={similar} /> : null}
      {tab === 'cast' ? <Cast vod={vod} /> : null}
    </Page>
  );
}

type LoadState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; vod: Vod; history?: History };

function DetailContent({ provider, site, params }: { provider: SiteProvider; site: Site; params: DetailParams }) {
  const { siteKey, vodId, vodName, vodPic } = params;
  const styles = useScaledStyles(makeStyles);
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
        setState({ status: 'error', message: `加载失败：${error instanceof Error ? error.message : String(error)}` });
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
    <Page pic={vodPic} backFocus={state.status === 'loading'}>
      <Text numberOfLines={1} style={[styles.title, styles.paramTitle]}>
        {vodName || '详情'}
      </Text>
      {state.status === 'loading' ? (
        <LoadingView />
      ) : (
        <ErrorView
          testID="detail-error"
          message={state.message}
          hasTVPreferredFocus
          onRetry={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        />
      )}
    </Page>
  );
}

export default function DetailScreen({ route }: RootStackScreenProps<'Detail'>) {
  const { siteKey, vodName } = route.params;
  const styles = useScaledStyles(makeStyles);
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
    <Page backFocus>
      <Text numberOfLines={1} style={[styles.title, styles.paramTitle]}>
        {vodName || '详情'}
      </Text>
      {status === 'loading' ? <LoadingView /> : <ErrorView testID="detail-unavailable" message="站点不可用" />}
    </Page>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    page: { flex: 1, backgroundColor: color.bg },
    scroll: { paddingBottom: s(space.xxl) },
    back: { marginTop: s(48), marginLeft: s(safeArea.horizontal) },
    info: { width: s(880), marginTop: s(50), marginLeft: s(safeArea.horizontal), gap: s(20) },
    tagLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(14) },
    tags: { ...text.label, color: color.text2 },
    title: { ...text.display, color: color.text },
    titleSm: { ...text.displaySm, color: color.text },
    paramTitle: { marginTop: s(50), marginHorizontal: s(safeArea.horizontal) },
    meta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(8) },
    score: { ...text.body, fontFamily: text.h1.fontFamily, color: color.text },
    content: { ...text.body, color: color.text2 },
    more: { ...text.caption, color: color.accent },
    people: { flexDirection: 'row' as const, gap: s(space.lg) },
    person: { flexDirection: 'row' as const, gap: s(space.sm), flexShrink: 1 },
    personLabel: { ...text.label, color: color.text3 },
    personValue: { ...text.label, color: color.text2, flexShrink: 1 },
    actions: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(18),
      marginTop: s(28),
      paddingHorizontal: s(safeArea.horizontal),
    },
    tabBar: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      marginTop: s(space.xl),
      paddingHorizontal: s(safeArea.horizontal),
    },
    tabs: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(36) },
    tabTools: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.sm) },
    empty: {
      ...text.body,
      color: color.text2,
      paddingHorizontal: s(safeArea.horizontal),
      paddingVertical: s(space.lg),
    },
    cast: { gap: s(space.md), paddingHorizontal: s(safeArea.horizontal), paddingTop: s(space.md) },
    castGroup: { gap: s(space.sm) },
    castNames: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: s(space.sm) },
  };
};
