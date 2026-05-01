import '../global.css';
import { useEffect } from 'react';
import { View, useColorScheme, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ColorsContext, darkThemeVars, lightThemeVars, dark, light } from '@/constants/theme';
import { getMe, hydrateSettings } from '@/lib/api';
import { AnalyticsProvider, analytics } from '@/lib/analytics';
import { getAuthToken, setUserId } from '@/lib/storage';
import { syncPushDeviceRegistrationIfEnabled } from '@/lib/notifications';

export default function RootLayout() {
  const scheme = useColorScheme();
  const colors = scheme === 'light' ? light : dark;

  useEffect(() => {
    async function identifyCurrentUser() {
      const token = await getAuthToken();
      if (!token) return;
      const me = await getMe();
      await setUserId(me.id);
      analytics.identify(me.id, {
        has_api_key: me.hasApiKey,
        central_key_available: me.centralKeyAvailable,
        auth_methods: me.authMethods,
      });
    }

    identifyCurrentUser()
      .catch(error => analytics.captureException(error, { route: 'root_layout', action: 'identify_current_user' }))
      .finally(() => analytics.track('app_opened'));

    hydrateSettings()
      .then(() => syncPushDeviceRegistrationIfEnabled())
      .catch(() => {});

    if (Platform.OS === 'web') {
      const loader = document.getElementById('gc-loader');
      if (loader) {
        loader.style.transition = 'opacity 0.3s ease-out';
        loader.style.opacity = '0';
        loader.style.pointerEvents = 'none';
        setTimeout(() => loader.remove(), 350);
      }
    }
  }, []);

  return (
    <AnalyticsProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ColorsContext.Provider value={colors}>
          <View style={[{ flex: 1 }, scheme === 'dark' ? darkThemeVars : lightThemeVars]}>
            <KeyboardProvider>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
              <StatusBar style="auto" />
            </KeyboardProvider>
          </View>
        </ColorsContext.Provider>
      </GestureHandlerRootView>
    </AnalyticsProvider>
  );
}
