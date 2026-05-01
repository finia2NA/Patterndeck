import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { getSettingsSnapshot } from '@/hooks/state/persistent/settingsStore';
import { hydrateSettings, registerPushDevice, unregisterPushDevice } from './api';
import {
  clearRegisteredExpoPushToken,
  getRegisteredExpoPushToken,
  setRegisteredExpoPushToken,
} from './storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function getExpoProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as {
    expoProjectId?: string;
    eas?: { projectId?: string };
  } | undefined;
  return Constants.easConfig?.projectId
    ?? extra?.eas?.projectId
    ?? extra?.expoProjectId
    ?? null;
}

async function configureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('due-decks', {
    name: 'Due decks',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4F46E5',
  });
}

export async function registerCurrentPushDevice(): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('Push notifications are only available on iOS and Android.');
  }
  if (!Device.isDevice) {
    throw new Error('Push notifications require a physical device.');
  }

  await configureAndroidNotificationChannel();

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;
  if (finalStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }
  if (finalStatus !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const projectId = getExpoProjectId();
  if (!projectId) {
    throw new Error('Expo project ID is missing. Set EXPO_PUBLIC_EXPO_PROJECT_ID and rebuild the native app.');
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerPushDevice(token, Platform.OS);
  await setRegisteredExpoPushToken(token);
  return token;
}

export async function unregisterCurrentPushDevice(): Promise<void> {
  const token = await getRegisteredExpoPushToken();
  try {
    await unregisterPushDevice(token ?? undefined);
  } finally {
    await clearRegisteredExpoPushToken();
  }
}

export async function syncPushDeviceRegistrationIfEnabled(): Promise<void> {
  if (Platform.OS === 'web') return;
  await hydrateSettings();
  if (getSettingsSnapshot().notifications_enabled === 'on') {
    await registerCurrentPushDevice();
  }
}
