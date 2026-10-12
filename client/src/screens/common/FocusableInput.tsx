import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { colors } from '../../ui';

/**
 * TextInput with a visible focus border. Android TV ignores hasTVPreferredFocus on a TextInput, so the input
 * takes the focus itself whenever the prop turns true.
 */
export function FocusableInput({ hasTVPreferredFocus, style, onFocus, onBlur, ...props }: TextInputProps) {
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (hasTVPreferredFocus && Platform.isTV) ref.current?.focus();
  }, [hasTVPreferredFocus]);

  return (
    <TextInput
      ref={ref}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={[styles.input, style, focused && styles.focused]}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 2,
    borderColor: colors.border,
  },
  focused: {
    borderColor: colors.focusBorder,
  },
});
