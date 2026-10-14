import { useEffect, useMemo, useState } from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { historyKey } from '../../core/storage';
import type { Vod } from '../../core/types';
import { getHistoryRepository, getKeepRepository } from '../../core/userData';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { Badge, Button, color, imageSource, safeArea, scaledText, useScaledStyles, type Scaler } from '../../ui';
import { htmlToText, openVod } from '../common';
import { buildPlayerParams } from '../detail/detailState';

export const HERO_HEIGHT = 720;
const BG_LEFT = 560;
const FADE_X_WIDTH = 760;
const FADE_Y_TOP = 420;
/** Titles longer than this many characters use the smaller display size. */
const LONG_TITLE = 8;

/** The vod the hero shows and the site it opens on. */
export interface HeroItem {
  siteKey: string;
  vod: Vod;
}

/** Blurred poster over the right of the hero, faded into the page from the left and the bottom. */
function HeroBackground({ poster }: { poster: string }) {
  const styles = useScaledStyles(makeStyles);
  const source = useMemo(() => imageSource(poster), [poster]);
  return (
    <View pointerEvents="none" style={styles.background}>
      {source ? (
        <Image testID="home-hero-bg" source={source} blurRadius={30} resizeMode="cover" style={styles.image} />
      ) : null}
      <Svg style={styles.fadeX} width="100%" height="100%">
        <Defs>
          <LinearGradient id="heroFadeX" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color.bg} stopOpacity={1} />
            <Stop offset="1" stopColor={color.bg} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#heroFadeX)" />
      </Svg>
      <Svg style={styles.fadeY} width="100%" height="100%">
        <Defs>
          <LinearGradient id="heroFadeY" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.bg} stopOpacity={0} />
            <Stop offset="1" stopColor={color.bg} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#heroFadeY)" />
      </Svg>
    </View>
  );
}

/** Keep (片单) state of one vod; null while unknown or without an active config. */
function useKept(cid: number | undefined, key: string): [boolean | null, (next: boolean) => void] {
  const [kept, setKept] = useState<{ key: string; value: boolean }>();
  useEffect(() => {
    if (cid === undefined) return;
    let active = true;
    void getKeepRepository()
      .isKept(key, cid)
      .then((value) => active && setKept({ key, value }));
    return () => {
      active = false;
    };
  }, [cid, key]);
  const value = cid !== undefined && kept?.key === key ? kept.value : null;
  return [value, (next) => setKept({ key, value: next })];
}

export function Hero({
  item,
  siteName,
  cid,
  preferFocus,
}: {
  item: HeroItem;
  siteName: string;
  cid: number | undefined;
  preferFocus: boolean;
}) {
  const { siteKey, vod } = item;
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const key = historyKey(siteKey, vod.vod_id);
  const [kept, setKept] = useKept(cid, key);

  const meta = [vod.vod_year, vod.vod_area].filter(Boolean);
  const description = vod.vod_content ? htmlToText(vod.vod_content) : '';

  const play = async () => {
    const record = cid === undefined ? undefined : await getHistoryRepository().get(cid, key);
    if (record)
      navigation.navigate(
        'Player',
        buildPlayerParams(
          siteKey,
          vod.vod_id,
          record.vodFlag,
          { name: record.vodRemarks, url: record.episodeUrl, desc: '', number: -1 },
          record.position,
        ),
      );
    else openVod(navigation, siteKey, vod);
  };

  const toggleKeep = async () => {
    if (cid === undefined || kept === null) return;
    const repository = getKeepRepository();
    if (kept) await repository.remove(key, cid);
    else await repository.add({ key, cid, siteName, vodName: vod.vod_name, vodPic: vod.vod_pic });
    setKept(!kept);
  };

  return (
    <View testID="home-hero" style={styles.hero}>
      <HeroBackground poster={vod.vod_pic} />
      <View style={styles.content}>
        {vod.vod_remarks || vod.type_name ? (
          <View style={styles.tags}>
            {vod.vod_remarks ? <Badge testID="home-hero-remarks" label={vod.vod_remarks} variant="accent" /> : null}
            {vod.type_name ? <Text style={styles.type}>{vod.type_name}</Text> : null}
          </View>
        ) : null}
        <Text
          testID="home-hero-title"
          numberOfLines={1}
          style={vod.vod_name.length > LONG_TITLE ? styles.titleLong : styles.title}
        >
          {vod.vod_name}
        </Text>
        {meta.length > 0 ? (
          <View style={styles.meta}>
            {meta.map((value) => (
              <Text key={value} style={styles.metaText}>
                {value}
              </Text>
            ))}
          </View>
        ) : null}
        {description ? (
          <Text testID="home-hero-description" numberOfLines={2} style={styles.description}>
            {description}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            testID="home-hero-play"
            title="立即播放"
            icon="play"
            variant="primary"
            hasTVPreferredFocus={preferFocus}
            onPress={() => void play()}
          />
          <Button
            testID="home-hero-keep"
            title={kept ? '已在片单' : '加入片单'}
            icon={kept ? 'check' : 'plus'}
            disabled={kept === null}
            onPress={() => void toggleKeep()}
          />
          <Button
            testID="home-hero-detail"
            title="详情"
            icon="info"
            onPress={() => openVod(navigation, siteKey, vod)}
          />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    hero: { height: s(HERO_HEIGHT) },
    background: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
    image: { position: 'absolute' as const, top: 0, left: s(BG_LEFT), right: 0, bottom: 0 },
    fadeX: { position: 'absolute' as const, top: 0, left: s(BG_LEFT), width: s(FADE_X_WIDTH), bottom: 0 },
    fadeY: { position: 'absolute' as const, top: s(FADE_Y_TOP), left: 0, right: 0, bottom: 0 },
    content: { position: 'absolute' as const, top: s(200), left: s(safeArea.horizontal), width: s(820), gap: s(20) },
    tags: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(14) },
    type: { ...text.caption, fontSize: s(22), lineHeight: s(30), color: color.text2 },
    title: { ...text.display, lineHeight: s(92), color: color.text },
    titleLong: { ...text.displaySm, lineHeight: s(76), color: color.text },
    meta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(18) },
    metaText: { ...text.body, fontSize: s(26), color: color.text2 },
    description: { ...text.body, lineHeight: s(42), maxWidth: s(720), color: color.text2 },
    actions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(18), marginTop: s(10) },
  };
};
