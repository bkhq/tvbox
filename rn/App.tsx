import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { getBootstrap } from './src/core/bootstrap';
import { RootNavigator } from './src/navigation';

export default function App() {
  useEffect(() => {
    void getBootstrap().start();
  }, []);

  return (
    <NavigationContainer theme={DarkTheme}>
      <RootNavigator />
      <StatusBar style="light" />
    </NavigationContainer>
  );
}
