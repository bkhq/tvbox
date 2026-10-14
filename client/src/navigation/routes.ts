import type { ComponentType } from 'react';

import CategoryScreen from '../screens/category';
import CollectScreen from '../screens/collect';
import ControlScreen from '../screens/control';
import DetailScreen from '../screens/detail';
import HistoryScreen from '../screens/history';
import HomeScreen from '../screens/home';
import LiveScreen from '../screens/live';
import PlayerScreen from '../screens/player';
import SearchScreen from '../screens/search';
import SettingsScreen from '../screens/settings';
import type { RootStackScreenProps, RouteName } from './types';

export interface RouteDefinition<K extends RouteName> {
  component: ComponentType<RootStackScreenProps<K>>;
  /** Header title on phones; TV screens are headerless. */
  title: string;
}

/**
 * Route name -> screen. Each feature owns client/src/screens/<feature>/index.tsx
 * and replaces its stub there without touching this file.
 */
export const routes: { [K in RouteName]: RouteDefinition<K> } = {
  Home: { component: HomeScreen, title: '首页' },
  Category: { component: CategoryScreen, title: '分类' },
  Search: { component: SearchScreen, title: '搜索' },
  Detail: { component: DetailScreen, title: '详情' },
  Player: { component: PlayerScreen, title: '播放' },
  Live: { component: LiveScreen, title: '直播' },
  History: { component: HistoryScreen, title: '历史记录' },
  Collect: { component: CollectScreen, title: '收藏' },
  Settings: { component: SettingsScreen, title: '设置' },
  Control: { component: ControlScreen, title: '手机控制' },
};

export const routeNames = Object.keys(routes) as RouteName[];
