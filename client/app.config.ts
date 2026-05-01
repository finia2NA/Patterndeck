import { ExpoConfig, ConfigContext } from 'expo/config';
import { existsSync } from 'node:fs';
import path from 'node:path';

const devServerHost = process.env.DEV_SERVER_HOST || 'localhost';
const devServerPort = process.env.DEV_SERVER_PORT || '3001';
const backendDebugUiEnabled = process.env.BACKEND_DEBUG_UI !== '0';
const expoProjectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || process.env.EXPO_PROJECT_ID;
const defaultAndroidGoogleServicesFile = './google-services.json';
const androidGoogleServicesFile = process.env.ANDROID_GOOGLE_SERVICES_FILE
  || (existsSync(path.resolve(__dirname, defaultAndroidGoogleServicesFile))
    ? defaultAndroidGoogleServicesFile
    : undefined);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'GrammarCrammer',
  slug: 'grammarcrammer',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'grammarcrammer',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.finite.grammarcrammer',
    deploymentTarget: '26.0',
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
        'GrammarCrammer connects to your development backend on your private Meshnet.',
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: 'com.finite.grammarcrammer',
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
    '@react-native-community/datetimepicker',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#000000',
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
    backendDebugUiEnabled,
    ...(expoProjectId ? {
      expoProjectId,
      eas: { projectId: expoProjectId },
    } : {}),
  },
});
