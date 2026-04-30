import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  AUTH_TOKEN: 'auth_token',
  USER_EMAIL: 'user_email',
  ONBOARDING_COMPLETE: 'onboarding_complete',
  COLLAPSED_NODES: 'collapsed_nodes',
  BACKEND_BASE_URL: 'backend_base_url',
} as const;

export async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.AUTH_TOKEN);
}

export async function setAuthToken(token: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.AUTH_TOKEN, token);
}

export async function clearAuthToken(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.AUTH_TOKEN);
}

export async function getUserEmail(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.USER_EMAIL);
}

export async function setUserEmail(email: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.USER_EMAIL, email);
}

export async function clearUserEmail(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.USER_EMAIL);
}

export async function isOnboardingComplete(): Promise<boolean> {
  const val = await AsyncStorage.getItem(KEYS.ONBOARDING_COMPLETE);
  return val === 'true';
}

export async function setOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(KEYS.ONBOARDING_COMPLETE, 'true');
}

export async function getCollapsedNodes(): Promise<Set<string>> {
  const val = await AsyncStorage.getItem(KEYS.COLLAPSED_NODES);
  if (!val) return new Set();
  try {
    return new Set(JSON.parse(val) as string[]);
  } catch {
    return new Set();
  }
}

export async function setCollapsedNodes(ids: Set<string>): Promise<void> {
  await AsyncStorage.setItem(KEYS.COLLAPSED_NODES, JSON.stringify([...ids]));
}

export async function getBackendBaseUrl(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.BACKEND_BASE_URL);
}

export async function setBackendBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.BACKEND_BASE_URL, url);
}

export async function clearBackendBaseUrl(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.BACKEND_BASE_URL);
}
