import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { getProvider, UnsupportedSiteError } from '../../core/provider';
import { useSetting } from '../../core/settings';
import type { Site } from '../../core/types';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RootStackScreenProps } from '../../navigation/types';
import {
  BackButton,
  Chip,
  Clock,
  color,
  focus,
  Icon,
  radii,
  safeArea,
  scaledText,
  SectionHeader,
  space,
  useScaledStyles,
  type Scaler,
} from '../../ui';
import { FocusableInput, LoadingView } from '../common';
import { parseWords, useSearchHistory } from './history';
import { Keyboard, KEYBOARD_WIDTH } from './Keyboard';
import { Results } from './Results';
import { searchSites, searchTargets, type SearchProgress } from './searchSites';
import { fetchHotWords, fetchSuggestWords } from './words';

/** CustomKeyboard stops adding characters at 20. */
const MAX_LENGTH = 20;
/** Typing pause before the suggestions are requested. */
export const SUGGEST_DELAY_MS = 300;

interface Submitted {
  keyword: string;
  quick: boolean;
}

function searchSite(site: Site, keyword: string, quick: boolean) {
  try {
    return getProvider(site).search(keyword, quick);
  } catch (error) {
    if (error instanceof UnsupportedSiteError) return Promise.reject(new Error('站点不支持搜索'));
    throw error;
  }
}

/** Searches every searchable site for the submitted keyword; a new submission or config cancels the previous search. */
function useSiteSearch(submitted: Submitted | undefined, sites: readonly Site[] | undefined) {
  const [progress, setProgress] = useState<{ for: Submitted; value: SearchProgress }>();
  useEffect(() => {
    if (!submitted || !sites) return;
    const { keyword, quick } = submitted;
    const handle = searchSites(
      searchTargets(sites, quick),
      (site) => searchSite(site, keyword, quick),
      (value) => setProgress({ for: submitted, value }),
    );
    return handle.cancel;
  }, [submitted, sites]);
  return progress && progress.for === submitted ? progress.value : undefined;
}

/** The cached hot words, refreshed in the background, and iQiyi suggestions for `text`. */
function useWords(text: string): { hot: string[]; suggest: string[] } {
  const [hotStored, setHotStored] = useSetting('hot');
  const hot = useMemo(() => parseWords(hotStored), [hotStored]);
  const [suggest, setSuggest] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchHotWords({ signal: controller.signal }).then(
      (words) => {
        if (words.length > 0) void setHotStored(JSON.stringify(words));
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [setHotStored]);

  useEffect(() => {
    if (!text) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchSuggestWords(text, { signal: controller.signal }).then(setSuggest, () => undefined);
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  return { hot, suggest };
}

function WordChips({
  title,
  caption,
  words,
  prefix,
  onPress,
  onLongPress,
}: {
  title: string;
  caption?: string;
  words: readonly string[];
  prefix: string;
  onPress: (word: string) => void;
  onLongPress?: (word: string) => void;
}) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.section} testID={prefix}>
      <SectionHeader title={title} caption={caption} />
      <View style={styles.chips}>
        {words.map((word) => (
          <Chip
            key={word}
            testID={`${prefix}-${word}`}
            label={word}
            onPress={() => onPress(word)}
            onLongPress={onLongPress ? () => onLongPress(word) : undefined}
          />
        ))}
      </View>
    </View>
  );
}

/** SearchActivity and CollectActivity in one page: keyboard on the left, history, suggestions or results on the right. */
export default function SearchScreen({ route }: RootStackScreenProps<'Search'>) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const { status, config } = useVodConfig();
  const [input, setInput] = useState('');
  const [quick, setQuick] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted>();
  const { history, add, remove } = useSearchHistory();
  const text = input.trim();
  const [inputFocused, setInputFocused] = useState(false);
  // The submitted search shows while the input holds its keyword; other text asks for suggestions.
  const shown = text && text === submitted?.keyword ? submitted : undefined;
  const { hot, suggest } = useWords(text && !shown ? text : '');
  const progress = useSiteSearch(submitted, config?.sites);

  const search = (value: string) => {
    const keyword = value.trim();
    if (!keyword) return;
    setInput(keyword);
    add(keyword);
    setSubmitted({ keyword, quick });
  };

  // A keyword in the route (home, detail, LAN push) searches at once, as SearchActivity does.
  const handled = useRef<object | undefined>(undefined);
  useEffect(() => {
    const params = route.params;
    if (!params?.keyword?.trim() || handled.current === params) return;
    handled.current = params;
    search(params.keyword);
    // Runs for new route params only; `search` reads the state of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params]);

  let pane;
  if (shown) {
    pane = !config?.sites ? (
      status === 'loading' ? (
        <LoadingView />
      ) : (
        <Text style={styles.note}>尚未加载配置</Text>
      )
    ) : progress ? (
      // Keyed by the submission so a new search starts on 全部.
      <Results key={`${shown.keyword}-${shown.quick}`} keyword={shown.keyword} progress={progress} />
    ) : null;
  } else {
    pane = (
      <ScrollView style={styles.words} contentContainerStyle={styles.wordsContent}>
        {text ? (
          suggest.length > 0 ? (
            <WordChips title="猜你想搜" words={suggest} prefix="search-suggest" onPress={search} />
          ) : null
        ) : (
          <>
            {history.length > 0 ? (
              <WordChips
                title="搜索历史"
                caption="长按删除"
                words={history}
                prefix="search-history"
                onPress={search}
                onLongPress={remove}
              />
            ) : null}
            {hot.length > 0 ? <WordChips title="热门搜索" words={hot} prefix="search-hot" onPress={search} /> : null}
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <BackButton testID="search-back" onPress={() => navigation.goBack()} />
        <Clock />
      </View>
      <View style={styles.body}>
        <View style={styles.left}>
          <View style={[styles.inputBox, inputFocused && styles.inputFocused]}>
            <Icon name="search" size={30} color={color.text2} />
            <FocusableInput
              testID="search-input"
              style={styles.input}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => search(input)}
              maxLength={MAX_LENGTH}
              placeholder="输入拼音首字母或片名"
              placeholderTextColor={color.text3}
              autoCorrect={false}
              returnKeyType="search"
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
            />
            <View style={styles.cursor} />
          </View>
          <Keyboard
            hasTVPreferredFocus
            onChar={(char) => setInput((value) => (value.length < MAX_LENGTH ? value + char : value))}
            onBackspace={() => setInput((value) => value.slice(0, -1))}
            onClear={() => setInput('')}
          />
          <View style={styles.actions}>
            <Chip testID="search-quick" label="快速搜索" selected={quick} onPress={() => setQuick((value) => !value)} />
            <Chip testID="search-submit" label="搜索" onPress={() => search(input)} />
          </View>
        </View>
        <View style={styles.pane}>{pane}</View>
      </View>
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    container: { flex: 1, backgroundColor: color.bg },
    top: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      marginTop: s(48),
      paddingHorizontal: s(safeArea.horizontal),
    },
    body: {
      flex: 1,
      flexDirection: 'row' as const,
      gap: s(space.xl),
      marginTop: s(40),
      paddingHorizontal: s(safeArea.horizontal),
      paddingBottom: s(safeArea.vertical),
    },
    left: { width: s(KEYBOARD_WIDTH), gap: s(28) },
    inputBox: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(space.sm),
      height: s(80),
      paddingHorizontal: s(space.md),
      borderRadius: s(radii.button),
      borderWidth: s(2),
      borderColor: color.divider,
      backgroundColor: color.surface,
    },
    inputFocused: { borderColor: focus.borderColor },
    input: {
      ...text.h2,
      flex: 1,
      minWidth: 0,
      height: s(60),
      padding: 0,
      borderWidth: 0,
      letterSpacing: s(2.5),
      color: color.text,
    },
    cursor: { width: s(3), height: s(40), backgroundColor: color.accent },
    actions: { flexDirection: 'row' as const, gap: s(12) },
    pane: { flex: 1 },
    words: { flex: 1 },
    wordsContent: { gap: s(space.lg), paddingVertical: s(space.xs) },
    section: { gap: s(space.sm) },
    chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: s(12) },
    note: { ...text.body, color: color.text2 },
  };
};
