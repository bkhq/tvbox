import { createContext, type ReactNode, type Ref, useContext } from 'react';
import { View } from 'react-native';

/**
 * Receives the element that D-pad focus entering the 设置 panel from the menu lands on. Set by the
 * first focusable element of the shown section; undefined outside the 设置 panel.
 */
export const EntryFocusContext = createContext<Ref<View> | undefined>(undefined);

export function useEntryRef(): Ref<View> | undefined {
  return useContext(EntryFocusContext);
}

/** Marks a UI-kit control (which takes no ref) as the panel entry by wrapping it in a view. */
export function FocusEntry({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const ref = useEntryRef();
  if (!enabled || !ref) return children;
  return (
    <View ref={ref} collapsable={false}>
      {children}
    </View>
  );
}
