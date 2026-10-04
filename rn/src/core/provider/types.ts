/**
 * SiteProvider: the seam between the UI and a site backend (CMS today, JS
 * spiders later). Methods mirror the spider API in docs/SPIDER.md and
 * resolve to normalised Results.
 */

import type { FetchLike } from '../http';
import type { Result, Site } from '../types';

export interface SiteProvider {
  readonly site: Site;
  /** homeContent: classes (with filters when `filter`) and an optional list. */
  home(filter: boolean): Promise<Result>;
  /** homeVideoContent: recommended list shown on the home page. */
  homeVideo(): Promise<Result>;
  category(tid: string, page: string, filter: boolean, extend: Record<string, string>): Promise<Result>;
  detail(ids: string[]): Promise<Result>;
  /** `page` defaults to "1". */
  search(key: string, quick: boolean, page?: string): Promise<Result>;
  player(flag: string, id: string, vipFlags: string[]): Promise<Result>;
  destroy?(): void | Promise<void>;
}

/** Dependencies handed to provider factories. */
export interface ProviderContext {
  /** Overrides the global fetch (tests). */
  fetch?: FetchLike;
}

export interface ProviderFactory {
  id: string;
  match(site: Site): boolean;
  create(site: Site, ctx: ProviderContext): SiteProvider;
}
