import { useEffect } from 'react';

import type { Class } from '../../core/types';
import { setMainNavAvailability } from '../../navigation/mainNav';

export type HomeSection = 'series' | 'movie';

const SECTION_NAMES: Record<HomeSection, readonly string[]> = { series: ['电视剧', '剧集', '连续剧'], movie: ['电影'] };

// Series first: a class taken by one section is never used for the other.
const SECTION_ORDER: readonly HomeSection[] = ['series', 'movie'];

/** The class backing each section, by category name: exact match first, then the first name containing one. */
export function resolveSections(classes: readonly Class[]): Partial<Record<HomeSection, Class>> {
  const result: Partial<Record<HomeSection, Class>> = {};
  const used = new Set<Class>();
  for (const section of SECTION_ORDER) {
    const names = SECTION_NAMES[section];
    const free = classes.filter((item) => !used.has(item));
    const match =
      free.find((item) => names.includes(item.type_name.trim())) ??
      free.find((item) => names.some((name) => item.type_name.includes(name)));
    if (match) {
      result[section] = match;
      used.add(match);
    }
  }
  return result;
}

/** Classes not used by a section, in their original order. */
export function remainingClasses(classes: readonly Class[], sections: Partial<Record<HomeSection, Class>>): Class[] {
  const used = new Set(Object.values(sections));
  return classes.filter((item) => !used.has(item));
}

/** Shows the 剧集 / 电影 tabs only when `classes` (undefined while loading or failed) has a match for them. */
export function useSectionAvailability(classes: readonly Class[] | undefined): void {
  useEffect(() => {
    if (!classes) return;
    const match = resolveSections(classes);
    setMainNavAvailability({ series: !!match.series, movie: !!match.movie });
  }, [classes]);
}
