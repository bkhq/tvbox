import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RootNavigator } from '../RootNavigator';
import { routeNames, routes } from '../routes';
import type { RootStackParamList } from '../types';

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

describe('RootNavigator', () => {
  it('registers every route', () => {
    expect(routeNames).toEqual([
      'Home',
      'Category',
      'Search',
      'Detail',
      'Player',
      'Live',
      'History',
      'Collect',
      'Settings',
      'Control',
    ]);
  });

  it('mounts on Home and renders every stub screen', async () => {
    const ref = createNavigationContainerRef<RootStackParamList>();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <NavigationContainer ref={ref}>
          <RootNavigator />
        </NavigationContainer>,
      );
    });
    expect(ref.getCurrentRoute()?.name).toBe('Home');
    expect(texts(renderer)).toContain('首页');

    const params: { [K in keyof RootStackParamList]: RootStackParamList[K] } = {
      Home: undefined,
      Category: { siteKey: 's', typeId: '1', typeName: '电影' },
      // A keyword would open the results at once.
      Search: undefined,
      Detail: { siteKey: 's', vodId: 'v' },
      Player: { siteKey: 's', vodId: 'v', position: 0 },
      Live: { groupIndex: 0 },
      History: undefined,
      Collect: undefined,
      Settings: undefined,
      Control: undefined,
    };
    for (const name of routeNames) {
      await act(async () => {
        (ref.navigate as any)(name, params[name]);
      });
      expect(ref.getCurrentRoute()?.name).toBe(name);
      expect(texts(renderer)).toContain(routes[name].title);
    }
    await act(async () => renderer.unmount());
  });
});
