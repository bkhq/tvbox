import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ComponentType } from 'react';

import { colors, useLayout } from '../ui';
import { routeNames, routes } from './routes';
import type { RootStackParamList, RouteName } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Screens behind the top navigation tabs: switching tabs swaps them in place so the bar stays still. */
const TAB_ROUTES: ReadonlySet<RouteName> = new Set(['Home', 'Live', 'Settings']);

export function RootNavigator({ initialRouteName = 'Home' }: { initialRouteName?: RouteName }) {
  const { isTV } = useLayout();
  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: !isTV,
        // A remote has no swipe-back to follow: screens cross-fade on TV instead of sliding.
        animation: isTV ? 'fade' : 'default',
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {routeNames.map((name) => (
        <Stack.Screen
          key={name}
          name={name}
          // The registry is typed per route; the mapped union cannot be narrowed here.
          component={routes[name].component as ComponentType<object>}
          options={{ title: routes[name].title, ...(isTV && TAB_ROUTES.has(name) ? { animation: 'none' } : null) }}
        />
      ))}
    </Stack.Navigator>
  );
}
