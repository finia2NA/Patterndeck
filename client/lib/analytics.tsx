import { ReactNode, useEffect } from 'react';
import { Platform, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { usePathname } from 'expo-router';
import { PostHog, PostHogErrorBoundary, PostHogProvider } from 'posthog-react-native';

type AnalyticsProperties = Record<string, any>;

const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const analyticsEnabled = process.env.EXPO_PUBLIC_ANALYTICS_ENABLED !== '0' && !!posthogKey;
export const appSessionId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const analyticsClient = analyticsEnabled
  ? new PostHog(posthogKey!, {
      host: posthogHost,
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      errorTracking: {
        autocapture: {
          uncaughtExceptions: true,
          unhandledRejections: true,
          console: [],
        },
      },
    })
  : null;

function commonProperties(): AnalyticsProperties {
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = undefined;
  }

  return {
    platform: Platform.OS,
    app_session_id: appSessionId,
    $session_id: appSessionId,
    os_name: Device.osName,
    os_version: Device.osVersion,
    timezone,
    app_version: Constants.expoConfig?.version,
  };
}

function cleanProperties(properties: AnalyticsProperties = {}): AnalyticsProperties {
  const clean: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined && value !== null) clean[key] = value;
  }
  return clean;
}

export const analytics = {
  enabled: analyticsEnabled,

  identify(userId: string, properties: AnalyticsProperties = {}) {
    if (!analyticsClient) return;
    analyticsClient.identify(userId, cleanProperties({ ...commonProperties(), ...properties }));
  },

  reset() {
    analyticsClient?.reset();
  },

  track(event: string, properties: AnalyticsProperties = {}) {
    if (!analyticsClient) return;
    analyticsClient.capture(event, cleanProperties({ ...commonProperties(), ...properties }));
  },

  screen(name: string, properties: AnalyticsProperties = {}) {
    if (!analyticsClient) return;
    analyticsClient.screen(name, cleanProperties({ ...commonProperties(), ...properties })).catch(() => {});
  },

  captureException(error: unknown, properties: AnalyticsProperties = {}) {
    if (!analyticsClient) return;
    analyticsClient.captureException(error, cleanProperties({ ...commonProperties(), ...properties }));
  },
};

function AnalyticsRouteTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    analytics.screen(pathname, { route: pathname });
  }, [pathname]);

  return null;
}

function ErrorFallback() {
  return (
    <View className="flex-1 bg-background items-center justify-center px-8">
      <Text className="text-error text-base text-center">Something went wrong. Please restart GrammarCrammer.</Text>
    </View>
  );
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  if (!analyticsClient) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider client={analyticsClient} autocapture={false}>
      <PostHogErrorBoundary fallback={<ErrorFallback />} additionalProperties={{ platform: Platform.OS }}>
        <AnalyticsRouteTracker />
        {children}
      </PostHogErrorBoundary>
    </PostHogProvider>
  );
}
