import type { NavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from '../../navigation/types';
import { bindLanNavigation, createLanNavigator } from '../navigation';

function fakeRef(ready: boolean) {
  const navigate = jest.fn();
  return { ref: { isReady: () => ready, navigate } as unknown as NavigationContainerRef<RootStackParamList>, navigate };
}

afterEach(() => bindLanNavigation(null));

describe('createLanNavigator', () => {
  it('opens Search with the keyword', () => {
    const { ref, navigate } = fakeRef(true);
    bindLanNavigation(ref);
    createLanNavigator().search('繁花');
    expect(navigate).toHaveBeenCalledWith('Search', { keyword: '繁花' });
  });

  it('opens the Player on an episode', () => {
    const { ref, navigate } = fakeRef(true);
    bindLanNavigation(ref);
    const params = { siteKey: 'a', vodId: 'v1', flag: 'line1', episodeUrl: 'e1', position: 5000 };
    createLanNavigator().play(params);
    expect(navigate).toHaveBeenCalledWith('Player', params);
  });

  it('does nothing before the container is bound or ready', () => {
    expect(() => createLanNavigator().search('a')).not.toThrow();
    const { ref, navigate } = fakeRef(false);
    bindLanNavigation(ref);
    createLanNavigator().search('a');
    createLanNavigator().play({ siteKey: 'a', vodId: 'v1', flag: 'f', episodeUrl: 'e' });
    expect(navigate).not.toHaveBeenCalled();
  });
});
