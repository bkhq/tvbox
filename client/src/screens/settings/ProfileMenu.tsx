import { useState } from 'react';
import { Pressable, Text, TVFocusGuideView } from 'react-native';

import { color, fontFamily, useScaledStyles, type Scaler } from '../../ui';
import { useCollectCount } from '../collect';
import { useHistoryCount } from '../history';
import { type SettingsSectionId, settingsSections, useSectionHint } from './sections';

function MenuItem({
  id,
  label,
  count,
  active,
  hasTVPreferredFocus,
  onSelect,
}: {
  id: SettingsSectionId;
  label: string;
  /** Record count shown instead of the section hint (片单, 历史). */
  count?: number;
  active: boolean;
  hasTVPreferredFocus: boolean;
  onSelect: (id: SettingsSectionId) => void;
}) {
  const styles = useScaledStyles(makeStyles);
  const [focused, setFocused] = useState(false);
  const sectionHint = useSectionHint(id);
  const hint = id === 'collect' || id === 'history' ? (count === undefined ? '' : String(count)) : sectionHint;
  return (
    <Pressable
      testID={`settings-menu-${id}`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={() => onSelect(id)}
      onFocus={() => {
        setFocused(true);
        onSelect(id);
      }}
      onBlur={() => setFocused(false)}
      style={[styles.item, active && styles.itemActive, focused && styles.itemFocused]}
    >
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {label}
      </Text>
      {hint ? (
        <Text testID={`settings-menu-${id}-hint`} style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Sidebar of the 设置 page. Focusing an entry selects it, so the focus guide's remembered child is
 * always the selected entry: coming back from the panel or the top bar lands on it.
 */
export function ProfileMenu({
  selected,
  onSelect,
  hasTVPreferredFocus,
}: {
  selected: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
  hasTVPreferredFocus: boolean;
}) {
  const styles = useScaledStyles(makeStyles);
  const counts: Partial<Record<SettingsSectionId, number>> = { collect: useCollectCount(), history: useHistoryCount() };
  return (
    <TVFocusGuideView testID="settings-menu" autoFocus style={styles.menu}>
      {settingsSections.map(({ id, label }) => (
        <MenuItem
          key={id}
          id={id}
          label={label}
          count={counts[id]}
          active={id === selected}
          hasTVPreferredFocus={hasTVPreferredFocus && id === selected}
          onSelect={onSelect}
        />
      ))}
    </TVFocusGuideView>
  );
}

const makeStyles = (s: Scaler) => ({
  menu: { width: s(400), gap: s(8) },
  item: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: s(16),
    height: s(68),
    // The always-present border keeps the label in place when the focus ring shows.
    paddingHorizontal: s(24 - 4),
    borderRadius: s(12),
    borderWidth: s(4),
    borderColor: 'transparent',
  },
  itemActive: { backgroundColor: color.surface2 },
  itemFocused: {
    borderColor: color.focusBorder,
    shadowColor: color.shadow,
    shadowOpacity: 1,
    shadowRadius: s(32),
    shadowOffset: { width: 0, height: s(14) },
    elevation: 12,
  },
  label: { flex: 1, fontFamily: fontFamily.medium, fontSize: s(31), lineHeight: s(38), color: color.text2 },
  labelActive: { fontFamily: fontFamily.bold, color: color.text },
  hint: { fontFamily: fontFamily.medium, fontSize: s(25), lineHeight: s(32), color: color.text3 },
});
