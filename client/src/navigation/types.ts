import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: { section?: 'series' | 'movie' } | undefined;
  Category: { siteKey: string; typeId: string; typeName: string };
  Search: { keyword?: string } | undefined;
  Detail: { siteKey: string; vodId: string; vodName?: string; vodPic?: string };
  Player:
    | { siteKey: string; vodId: string; flag?: string; episodeUrl?: string; position?: number }
    | { url: string; title?: string; headers?: Record<string, string>; position?: number };
  Live: { groupIndex?: number; channelIndex?: number } | undefined;
  History: undefined;
  Collect: undefined;
  Settings: undefined;
  Control: undefined;
};

export type RouteName = keyof RootStackParamList;

export type RootStackScreenProps<K extends RouteName> = NativeStackScreenProps<RootStackParamList, K>;

export type AppNavigation = NativeStackNavigationProp<RootStackParamList>;

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
