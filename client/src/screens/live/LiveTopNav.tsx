import { useMainNav } from '../../navigation/mainNav';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { Button, TopNav } from '../../ui';

/** Main top bar of the live screen, 直播 active, with the 手机控制 / 设置 buttons. */
export function LiveTopNav() {
  const navigation = useAppNavigation();
  const nav = useMainNav('live');
  return (
    <TopNav
      items={nav.items}
      onSelect={nav.select}
      onSearch={() => navigation.navigate('Search')}
      right={
        <>
          <Button
            testID="live-nav-control"
            variant="outline"
            icon="phone"
            accessibilityLabel="手机控制"
            onPress={() => navigation.navigate('Control')}
          />
          <Button
            testID="live-nav-settings"
            variant="outline"
            icon="settings"
            accessibilityLabel="设置"
            onPress={() => navigation.navigate('Settings')}
          />
        </>
      }
    />
  );
}
