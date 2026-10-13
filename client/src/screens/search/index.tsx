import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useSetting } from '../../core/settings';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RootStackScreenProps } from '../../navigation/types';
import { colors, FocusableButton, fontSize, radius, spacing } from '../../ui';
import { FocusableInput } from '../common';
import { parseWords, useSearchHistory } from './history';
import { Keyboard, keyboardWidth } from './Keyboard';
import { fetchHotWords, fetchSuggestWords } from './words';

/** CustomKeyboard stops adding characters at 20. */
const MAX_LENGTH = 20;
/** Typing pause before the suggestions are requested. */
export const SUGGEST_DELAY_MS = 300;
const KEY_ROWS = 7;

function WordList({
  title,
  words,
  prefix,
  onPress,
  onLongPress,
}: {
  title: string;
  words: readonly string[];
  prefix: string;
  onPress: (word: string) => void;
  onLongPress?: (word: string) => void;
}) {
  return (
    <View style={styles.section} testID={prefix}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.words}>
        {words.map((word) => (
          <FocusableButton
            key={word}
            testID={`${prefix}-${word}`}
            title={word}
            style={styles.word}
            onPress={() => onPress(word)}
            onLongPress={onLongPress ? () => onLongPress(word) : undefined}
          />
        ))}
      </View>
    </View>
  );
}

/** Hot words while the input is empty, iQiyi suggestions for the typed text otherwise. */
function useWords(text: string): string[] {
  const [hotStored, setHotStored] = useSetting('hot');
  const hot = useMemo(() => parseWords(hotStored), [hotStored]);
  const [suggest, setSuggest] = useState<string[]>([]);

  // The last hot list shows at once and is refreshed in the background.
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

  return text ? suggest : hot;
}

/** SearchActivity: on-screen keyboard, search history and hot words; results open on their own screen. */
export default function SearchScreen({ route }: RootStackScreenProps<'Search'>) {
  const navigation = useAppNavigation();
  const { height } = useWindowDimensions();
  const [input, setInput] = useState('');
  const [quick, setQuick] = useState(false);
  const { history, add, remove } = useSearchHistory();
  const text = input.trim();
  const words = useWords(text);
  const keySize = Math.max(28, Math.min(56, Math.floor((height - 120) / KEY_ROWS) - spacing.xs));

  const search = (value: string) => {
    const keyword = value.trim();
    if (!keyword) return;
    setInput(keyword);
    add(keyword);
    navigation.navigate('SearchResult', { keyword, quick });
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

  return (
    <View style={styles.container}>
      <View style={[styles.left, { width: keyboardWidth(keySize) + spacing.xl * 2 }]}>
        <FocusableInput
          testID="search-input"
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => search(input)}
          placeholder="输入关键词"
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
        />
        <Keyboard
          keySize={keySize}
          quick={quick}
          hasTVPreferredFocus
          onChar={(char) => setInput((value) => (value.length < MAX_LENGTH ? value + char : value))}
          onBackspace={() => setInput((value) => value.slice(0, -1))}
          onClear={() => setInput('')}
          onToggleQuick={() => setQuick((value) => !value)}
          onSearch={() => search(input)}
        />
      </View>
      <ScrollView style={styles.right} contentContainerStyle={styles.rightContent}>
        {history.length > 0 ? (
          <WordList
            title="搜索历史（长按删除）"
            words={history}
            prefix="search-history"
            onPress={search}
            onLongPress={remove}
          />
        ) : null}
        {words.length > 0 ? (
          <WordList title={text ? '猜你想搜' : '热门搜索'} words={words} prefix="search-word" onPress={search} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  left: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  input: {
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.title,
  },
  right: { flex: 1 },
  rightContent: { paddingTop: spacing.lg, paddingRight: spacing.xl },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    marginHorizontal: spacing.xs,
    marginBottom: spacing.xs,
    color: colors.textSecondary,
    fontSize: fontSize.title,
  },
  words: { flexDirection: 'row', flexWrap: 'wrap' },
  word: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
