import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Image, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { historyKey } from '../../core/storage';
import type { Vod } from '../../core/types';
import { getHistoryRepository, getKeepRepository } from '../../core/userData';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import {
  Badge,
  Button,
  color,
  focus,
  fontFamily,
  imageSource,
  radii,
  safeArea,
  scaledText,
  space,
  tabular,
  type,
  useScale,
  useScaledStyles,
  type Scaler,
} from '../../ui';
import { displayRemarks, htmlToText, openVod } from '../common';
import { buildPlayerParams } from '../detail/detailState';

export const HERO_HEIGHT = 900;
/** Top of the recommendation strip along the hero's bottom: browsing it repaints the hero above it. */
export const HERO_STRIP_TOP = 590;
const BG_LEFT = 560;
const FADE_X_WIDTH = 760;
const FADE_Y_TOP = 560;
/** Titles longer than this many characters use the smaller display size. */
const LONG_TITLE = 8;
const BLUR_RADIUS = 30;
/** Cross-fade between hero items: posters, and the info sliding up into place. */
const HERO_FADE_MS = 280;
const INFO_RISE = 16;
/** Bottom edge of the hero buttons: the info above grows upward, so the buttons never move between items. */
const ACTIONS_BOTTOM = 540;
/** Sharp 2:3 poster on the right of the hero, over the blurred copy and clear of the strip. */
const POSTER = { width: 272, height: 408, top: 150 } as const;
/**
 * The blur samples transparent pixels past the bitmap border, so the outer edges of a blurred image fade out and the
 * page shows through as a lighter band. The image box overshoots the clipped hero by this much on its outer edges.
 */
const BLUR_BLEED = BLUR_RADIUS * 2;
/** Room for the title's descenders ("g" in Girigo): about 1.15x the font size. */
const TITLE_LINE_HEIGHT = 1.15;
/** Widest hero button in design px (立即播放 is ~250). */
const ACTION_MAX_WIDTH = 320;
/**
 * Button gap: a focused button grows by (scale - 1) / 2 of its width per side and its ring (gap + width, also
 * scaled) sits outside that, so the neighbour gets at least space.sm of clearance. 22 + 8 = 30.
 */
export const HERO_ACTION_GAP =
  Math.ceil(((focus.scale - 1) / 2) * ACTION_MAX_WIDTH + (focus.ringGap + focus.ringWidth) * focus.scale) + space.sm;

/** The vod the hero shows and the site it opens on. */
export interface HeroItem {
  siteKey: string;
  vod: Vod;
}

/**
 * The poster urls on screen: the previous one stays under the current one while that fades in. Keyed by url, so the
 * outgoing image keeps its view (no reload) when it moves underneath.
 */
function usePosterLayers(poster: string): string[] {
  const [layers, setLayers] = useState([poster]);
  const current = layers[layers.length - 1];
  if (current !== poster) setLayers([current!, poster]);
  return current === poster ? layers : [current!, poster];
}

/** One poster layer; a layer added over another fades in. */
function FadeLayer({ fadeIn, style, children }: { fadeIn: boolean; style?: object; children: ReactNode }) {
  const [opacity] = useState(() => new Animated.Value(fadeIn ? 0 : 1));
  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: HERO_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

/** Blurred poster over the right of the hero, faded into the page from the left and the bottom. */
function HeroBackground({ poster }: { poster: string }) {
  const styles = useScaledStyles(makeStyles);
  const layers = usePosterLayers(poster);
  // Stable source objects: a new one on every render would make the image view reload.
  const key = layers.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sources = useMemo(() => layers.map((url) => imageSource(url)), [key]);
  const fill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
  return (
    <View testID="home-hero-background" pointerEvents="none" style={styles.background}>
      {layers.map((url, index) => {
        const source = sources[index];
        const current = index === layers.length - 1;
        return source ? (
          <FadeLayer key={url} fadeIn={layers.length > 1} style={fill}>
            <Image
              testID={current ? 'home-hero-bg' : undefined}
              source={source}
              blurRadius={BLUR_RADIUS}
              resizeMode="cover"
              resizeMethod="resize"
              style={styles.image}
            />
          </FadeLayer>
        ) : null;
      })}
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
      {layers.map((url, index) => {
        const source = sources[index];
        const current = index === layers.length - 1;
        return source ? (
          <FadeLayer key={url} fadeIn={layers.length > 1} style={styles.poster}>
            <Image
              testID={current ? 'home-hero-poster' : undefined}
              source={source}
              resizeMode="cover"
              resizeMethod="resize"
              style={styles.posterImage}
            />
          </FadeLayer>
        ) : null;
      })}
    </View>
  );
}

/** Tags, title, meta and description of the hero: each new item fades and rises into place. */
function HeroInfo({ itemKey, children }: { itemKey: string; children: ReactNode }) {
  const styles = useScaledStyles(makeStyles);
  const { s } = useScale();
  const [progress] = useState(() => new Animated.Value(1));
  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: HERO_FADE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, itemKey]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [s(INFO_RISE), 0] });
  return (
    <Animated.View style={[styles.info, { opacity: progress, transform: [{ translateY }] }]}>{children}</Animated.View>
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
  strip,
}: {
  item: HeroItem;
  siteName: string;
  cid: number | undefined;
  preferFocus: boolean;
  /** Recommendation row along the bottom of the hero. */
  strip?: ReactNode;
}) {
  const { siteKey, vod } = item;
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const key = historyKey(siteKey, vod.vod_id);
  const [kept, setKept] = useKept(cid, key);

  const meta = [vod.vod_year, vod.vod_area].filter(Boolean);
  const description = vod.vod_content ? htmlToText(vod.vod_content) : '';
  const remarks = displayRemarks(vod.vod_remarks);

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
        <HeroInfo itemKey={key}>
          {remarks || vod.type_name ? (
            <View style={styles.tags}>
              {remarks ? <Badge testID="home-hero-remarks" label={remarks} variant="accent" /> : null}
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
          {vod.vod_score || meta.length > 0 ? (
            <View style={styles.meta}>
              {vod.vod_score ? (
                <Text testID="home-hero-score" style={styles.score}>
                  {vod.vod_score}
                </Text>
              ) : null}
              {meta.map((value) => (
                <Text key={value} style={styles.metaText}>
                  {value}
                </Text>
              ))}
            </View>
          ) : null}
          {description ? (
            <Text testID="home-hero-description" numberOfLines={1} style={styles.description}>
              {description}
            </Text>
          ) : null}
        </HeroInfo>
        <View testID="home-hero-actions" style={styles.actions}>
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
      {strip ? <View style={styles.strip}>{strip}</View> : null}
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    hero: { height: s(HERO_HEIGHT) },
    strip: { position: 'absolute' as const, top: s(HERO_STRIP_TOP), left: 0, right: 0 },
    background: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' as const },
    // Left edge stays: the left fade covers it.
    image: {
      position: 'absolute' as const,
      top: -s(BLUR_BLEED),
      left: s(BG_LEFT),
      right: -s(BLUR_BLEED),
      bottom: -s(BLUR_BLEED),
    },
    fadeX: { position: 'absolute' as const, top: 0, left: s(BG_LEFT), width: s(FADE_X_WIDTH), bottom: 0 },
    fadeY: { position: 'absolute' as const, top: s(FADE_Y_TOP), left: 0, right: 0, bottom: 0 },
    poster: {
      position: 'absolute' as const,
      top: s(POSTER.top),
      right: s(safeArea.horizontal),
      width: s(POSTER.width),
      height: s(POSTER.height),
      borderRadius: s(radii.card),
      overflow: 'hidden' as const,
    },
    posterImage: { width: '100%' as const, height: '100%' as const },
    content: {
      position: 'absolute' as const,
      bottom: s(HERO_HEIGHT - ACTIONS_BOTTOM),
      left: s(safeArea.horizontal),
      width: s(820),
      gap: s(20),
    },
    info: { gap: s(20) },
    tags: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(14) },
    type: { ...text.caption, color: color.text2 },
    title: { ...text.display, lineHeight: s(Math.round(type.display.fontSize * TITLE_LINE_HEIGHT)), color: color.text },
    titleLong: {
      ...text.displaySm,
      lineHeight: s(Math.round(type.displaySm.fontSize * TITLE_LINE_HEIGHT)),
      color: color.text,
    },
    meta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(18) },
    metaText: { ...text.body, color: color.text2 },
    score: { ...text.body, ...tabular, fontFamily: fontFamily.bold, color: color.text },
    description: { ...text.body, lineHeight: s(42), maxWidth: s(720), color: color.text2 },
    actions: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(HERO_ACTION_GAP),
      marginTop: s(10),
    },
  };
};
