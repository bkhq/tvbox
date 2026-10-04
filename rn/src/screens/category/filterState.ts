import type { Filter } from '../../core/types';

/** Selected value per filter key. */
export type FilterSelection = Readonly<Record<string, string>>;

/** Each filter starts at its `init` value, or its first value. */
export function initialSelection(filters: readonly Filter[]): FilterSelection {
  const selection: Record<string, string> = {};
  for (const filter of filters) selection[filter.key] = filter.init || filter.value[0]?.v || '';
  return selection;
}

export function selectFilter(selection: FilterSelection, key: string, value: string): FilterSelection {
  return { ...selection, [key]: value };
}

/** The `extend` argument of category(): keys with an empty value are omitted. */
export function toExtend(selection: FilterSelection): Record<string, string> {
  const extend: Record<string, string> = {};
  for (const [key, value] of Object.entries(selection)) if (value) extend[key] = value;
  return extend;
}
