import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { FocusableCard } from '../FocusableCard';
import { colors, focusScale } from '../theme';

// react-native resolves components lazily on first access; resolve the ones the
// card renders while the file loads so no test pays that cost inside its timeout.
void [Image, Pressable, Text, View];

// The host view rendered by Pressable; it receives the focus events and the style.
function card(renderer: ReactTestRenderer) {
  const [node] = renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'card');
  return node!;
}

function cardStyle(renderer: ReactTestRenderer) {
  return StyleSheet.flatten(card(renderer).props.style);
}

describe('FocusableCard', () => {
  it('toggles the focus style on focus and blur', async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FocusableCard testID="card" title="Movie" remark="HD" onFocus={onFocus} onBlur={onBlur} />);
    });

    expect(cardStyle(renderer).transform).toBeUndefined();

    await act(async () => {
      card(renderer).props.onFocus();
    });
    expect(cardStyle(renderer)).toMatchObject({
      borderColor: colors.focusBorder,
      transform: [{ scale: focusScale }],
    });
    expect(onFocus).toHaveBeenCalledTimes(1);

    await act(async () => {
      card(renderer).props.onBlur();
    });
    expect(cardStyle(renderer).transform).toBeUndefined();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('forwards press handlers and preferred focus', async () => {
    const onPress = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FocusableCard testID="card" title="Movie" onPress={onPress} hasTVPreferredFocus />);
    });
    expect(card(renderer).props.hasTVPreferredFocus).toBe(true);
    const [pressable] = renderer.root.findAll((n) => n.props.testID === 'card' && n.props.onPress === onPress);
    expect(pressable).toBeDefined();
    pressable!.props.onPress();
    expect(onPress).toHaveBeenCalled();
  });
});
