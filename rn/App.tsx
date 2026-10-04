import { createNavigationContainerRef, DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { getBootstrap } from './src/core/bootstrap';
import { RootNavigator, type RootStackParamList } from './src/navigation';
import { setPlayerOpener } from './src/player';
import { registerBuiltinEngines } from './src/player/engines';
import { setLiveOpener } from './src/player/live';
import { UpdatePrompt } from './src/update';

registerBuiltinEngines();

const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  useEffect(() => {
    void getBootstrap().start();
  }, []);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={DarkTheme}
      onReady={() => {
        setPlayerOpener((request) => navigationRef.navigate('Player', request));
        setLiveOpener((params) => navigationRef.navigate('Live', params));
      }}
    >
      <RootNavigator />
      <UpdatePrompt />
      <StatusBar style="light" />
    </NavigationContainer>
  );
}
