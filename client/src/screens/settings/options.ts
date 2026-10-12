import type { VodConfigSnapshot } from '../../core/bootstrap';
import { parseSetting, type SettingKey, type Settings } from '../../core/settings';

/** Pure value-display and option logic of the settings screen. */

export interface Option<T> {
  readonly value: T;
  readonly label: string;
}

export type BooleanKey = { [K in SettingKey]: Settings[K] extends boolean ? K : never }[SettingKey];
/** Free-text settings (enum-backed string settings excluded). */
export type TextKey = { [K in SettingKey]: string extends Settings[K] ? K : never }[SettingKey];

/** Settings edited by cycling through a short option list. */
export const CHOICES = {
  playerEngine: [
    { value: 'auto', label: '自动（iOS 默认 MPV，Android 默认系统播放器）' },
    { value: 'video', label: '系统播放器' },
    { value: 'mpv', label: 'MPV' },
  ],
  decode: [
    { value: 'hard', label: '硬解' },
    { value: 'soft', label: '软解' },
  ],
  render: [
    { value: 'surface', label: 'Surface' },
    { value: 'texture', label: 'Texture' },
  ],
  scale: [
    { value: 0, label: '原始' },
    { value: 1, label: '16:9' },
    { value: 2, label: '4:3' },
    { value: 3, label: '填充' },
    { value: 4, label: '裁剪' },
  ],
  subtitleStyleSource: [
    { value: 'original', label: '原始' },
    { value: 'system', label: '系统' },
    { value: 'custom', label: '自定义' },
  ],
  siteMode: [
    { value: 0, label: '列表' },
    { value: 1, label: '网格' },
  ],
} as const satisfies { [K in SettingKey]?: readonly Option<Settings[K]>[] };

export type ChoiceKey = keyof typeof CHOICES;

export interface Step {
  readonly step: number;
  format(value: number): string;
}

/** Numeric settings edited with -/+ buttons; the schema clamps to its range. */
export const STEPS = {
  buffer: { step: 1, format: (value) => String(value) },
  speedLongPress: { step: 0.5, format: (value) => formatSpeed(value) },
  subtitleScale: { step: 0.1, format: (value) => `${value.toFixed(1)}x` },
  subtitlePosition: { step: 1, format: (value) => String(value) },
} as const satisfies { [K in SettingKey]?: Step };

export type StepKey = keyof typeof STEPS;

export function choiceOptions<K extends ChoiceKey>(key: K): readonly Option<Settings[K]>[] {
  return CHOICES[key] as unknown as readonly Option<Settings[K]>[];
}

export function optionLabel<T>(options: readonly Option<T>[], value: T): string {
  return options.find((option) => option.value === value)?.label ?? String(value);
}

/** The option after `value`, wrapping around; the first one when `value` is unknown. */
export function cycleOption<T>(options: readonly Option<T>[], value: T): T {
  const index = options.findIndex((option) => option.value === value);
  const next = options[(index + 1) % options.length];
  return next ? next.value : value;
}

/** `value` moved by one step in `direction`, rounded and clamped by the schema. */
export function stepValue<K extends StepKey>(key: K, value: number, direction: 1 | -1): Settings[K] {
  const next = Math.round((value + direction * STEPS[key].step) * 100) / 100;
  return parseSetting(key, next) ?? (value as Settings[K]);
}

export function formatSpeed(value: number): string {
  return `${value}x`;
}

export function formatBoolean(value: boolean): string {
  return value ? '开' : '关';
}

export function formatText(value: string): string {
  return value || '未设置';
}

/** Row value of the VOD config: the active entry or the bootstrap status. */
export function vodStatusText({ status, entry, error }: VodConfigSnapshot): string {
  const name = entry?.name || entry?.url || '';
  switch (status) {
    case 'loading':
      return name ? `${name}（加载中…）` : '加载中…';
    case 'ready':
      return name;
    case 'empty':
      return '未设置';
    case 'error':
      return `加载失败：${error?.message ?? ''}`;
  }
}
