import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { getBootstrap } from './src/core/bootstrap';
import { RootNavigator } from './src/navigation';
import { UpdatePrompt } from './src/update';

export default function App() {
  useEffect(() => {
    void getBootstrap().start();
  }, []);

  return (
    <NavigationContainer theme={DarkTheme}>
      <RootNavigator />
      <UpdatePrompt />
      <StatusBar style="light" />
    </NavigationContainer>
  );
}
