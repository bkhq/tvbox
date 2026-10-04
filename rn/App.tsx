import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';

import { RootNavigator } from './src/navigation';

export default function App() {
  return (
    <NavigationContainer theme={DarkTheme}>
      <RootNavigator />
      <StatusBar style="light" />
    </NavigationContainer>
  );
}
