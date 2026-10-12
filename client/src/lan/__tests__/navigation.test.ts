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

  it('does nothing before the container is bound or ready', () => {
    expect(() => createLanNavigator().search('a')).not.toThrow();
    const { ref, navigate } = fakeRef(false);
    bindLanNavigation(ref);
    createLanNavigator().search('a');
    expect(navigate).not.toHaveBeenCalled();
  });
});
