import { ExpoConfig, ConfigContext } from 'expo/config';
import { existsSync } from 'node:fs';
import path from 'node:path';

const devServerHost = process.env.DEV_SERVER_HOST || 'localhost';
const devServerPort = process.env.DEV_SERVER_PORT || '3001';
const productionBackendBaseUrl = process.env.EXPO_PUBLIC_API_URL || 'https://patterndeck.richardhanss.de/api/v1';
const backendDebugUiEnabled = process.env.BACKEND_DEBUG_UI !== '0';
const expoProjectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || '156c0c3e-7336-42b4-9805-a98c8fd83832';
const defaultAndroidGoogleServicesFile = './google-services.json';
const androidGoogleServicesFile = process.env.ANDROID_GOOGLE_SERVICES_FILE
  || (existsSync(path.resolve(__dirname, defaultAndroidGoogleServicesFile))
    ? defaultAndroidGoogleServicesFile
    : undefined);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'PatternDeck',
  slug: 'patterndeck',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'patterndeck',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'de.richardhanss.patterndeck',
    // @ts-expect-error deploymentTarget is valid but missing from Expo's type definitions
    deploymentTarget: '26.0',
    icon: {
      light: './assets/images/icon.png',
      dark: './assets/images/icon-dark.png',
    },
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: {
          'tora.nord': {
            NSExceptionAllowsInsecureHTTPLoads: true,
          },
        },
      },
      NSLocalNetworkUsageDescription:
        'PatternDeck connects to your development backend on your private Meshnet.',
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#FAECDC',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // @ts-expect-error edgeToEdgeEnabled is valid but missing from Expo's type definitions
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: 'de.richardhanss.patterndeck',
    ...(androidGoogleServicesFile ? { googleServicesFile: androidGoogleServicesFile } : {}),
  },
  web: {
    output: 'static' as const,
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-notifications',
    './plugins/without-ios-push-notifications',
    '@react-native-community/datetimepicker',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 320,
        resizeMode: 'contain',
        backgroundColor: '#FAECDC',
        dark: {
          image: './assets/images/splash-icon-dark.png',
          backgroundColor: '#141517',
        },
        android: {
          image: './assets/images/splash-icon-android.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#FAECDC',
          dark: {
            backgroundColor: '#141517',
          },
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    devServerHost,
    devServerPort,
    productionBackendBaseUrl,
    backendDebugUiEnabled,
    expoProjectId,
    eas: { projectId: expoProjectId },
  },
});
