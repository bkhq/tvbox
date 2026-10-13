import * as ui from '../index';

describe('ui exports', () => {
  it('exposes every runtime export of the kit', () => {
    expect(Object.keys(ui).sort()).toEqual(
      [
        // Legacy components and theme.
        'FocusableButton',
        'FocusableCard',
        'FocusGrid',
        'HorizontalRow',
        'imageSource',
        'PlaceholderScreen',
        'colors',
        'focusScale',
        'fontSize',
        'radius',
        'spacing',
        'theme',
        'computeLayout',
        'useLayout',
        // Tokens, scaling, typography and focus animation.
        'DESIGN_WIDTH',
        'makeScaler',
        'scaleFor',
        'useScale',
        'useScaledStyles',
        'card',
        'color',
        'focus',
        'radii',
        'safeArea',
        'space',
        'tokens',
        'type',
        'fontFamily',
        'scaledText',
        'tabular',
        'text',
        'focusSpring',
        'useFocusAnimation',
        // Components.
        'AnimatedPressable',
        'BackButton',
        'Badge',
        'Button',
        'ChannelCard',
        'Chip',
        'Clock',
        'FocusRing',
        'formatClock',
        'Grid',
        'Icon',
        'iconNames',
        'Logo',
        'PosterCard',
        'Row',
        'SectionHeader',
        'Tab',
        'TopNav',
        'WideCard',
      ].sort(),
    );
  });

  it('exports usable values', () => {
    const { BackButton, Badge, Button, Chip, Clock, FocusRing, Grid, Icon, Logo, Row, SectionHeader, Tab, TopNav } = ui;
    for (const component of [
      BackButton,
      Badge,
      Button,
      Chip,
      Clock,
      FocusRing,
      Grid,
      Icon,
      Logo,
      Row,
      SectionHeader,
      Tab,
      TopNav,
    ]) {
      expect(typeof component).toBe('function');
    }
    // memo() and animated components are objects.
    for (const component of [ui.PosterCard, ui.WideCard, ui.ChannelCard, ui.AnimatedPressable]) {
      expect(component).toBeTruthy();
    }
    expect(ui.iconNames).toContain('logo');
    expect(ui.formatClock(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
  });
});

// Compile-time check that the Props types are exported.
export type ExportedTypes = [
  ui.BackButtonProps,
  ui.BadgeProps,
  ui.BadgeVariant,
  ui.ButtonProps,
  ui.ButtonSize,
  ui.ButtonVariant,
  ui.FocusableProps,
  ui.ChannelCardProps,
  ui.ChipProps,
  ui.ClockProps,
  ui.GridProps<unknown>,
  ui.GridVariant,
  ui.IconName,
  ui.IconProps,
  ui.LogoProps,
  ui.PosterCardProps,
  ui.RowProps<unknown>,
  ui.SectionHeaderProps,
  ui.TabProps,
  ui.TopNavProps,
  ui.WideCardProps,
  ui.FocusableButtonProps,
  ui.FocusableCardProps,
  ui.FocusGridProps<unknown>,
  ui.HorizontalRowProps<unknown>,
  ui.PlaceholderScreenProps,
  ui.Theme,
  ui.Layout,
  ui.Scaler,
  ui.Tokens,
  ui.TextVariant,
  ui.FocusAnimation,
  ui.FocusAnimationCallbacks,
];
