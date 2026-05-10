import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
  Animated,
  StyleSheet,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearBackendBaseUrl, getBackendBaseUrl, setAuthToken, setBackendBaseUrl, setUserEmail, setUserId, setUserRole } from '@/lib/storage';
import {
  register,
  login,
  setApiKey,
  validateApiKey,
  getMe,
  hydrateSettings,
  forgotPassword,
  resolveBackendBaseUrlForPlatform,
} from '@/lib/api';
import { useColors } from '@/constants/theme';
import { OnboardingBackground } from '@/components/OnboardingBackground';
import { validateEmail, validatePassword } from '@patterndeck/shared';
import { RainbowButton } from '@/components/RainbowButton';
import { AccountCard } from '@/components/onboarding/AccountCard';
import { ApiKeyCard } from '@/components/onboarding/ApiKeyCard';
import { ForgotPasswordCard } from '@/components/onboarding/ForgotPasswordCard';
import { analytics } from '@/lib/analytics';
import { BrandLogo } from '@/components/BrandLogo';
import { useI18n } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';

// ─── Card content ────────────────────────────────────────────────────────────

const TOTAL_STEPS = 3;
const BACKEND_DEBUG_UI_ENABLED = __DEV__ && Constants.expoConfig?.extra?.backendDebugUiEnabled !== false;

const WelcomeCard = memo(function WelcomeCard({ t }: { t: (key: TranslationKey) => string }) {
  return (
    <>
      <BrandLogo size={58} wordmarkSize={26} style={styles.welcomeBrand} />
      <Text className="text-4xl font-bold text-foreground mb-3">
        {t('onboarding.welcomeTitle')}
      </Text>
      <Text className="text-foreground-secondary text-base leading-7">
        {t('onboarding.welcomeBody')}
      </Text>
    </>
  );
});

const HowItWorksCard = memo(function HowItWorksCard({ t }: { t: (key: TranslationKey) => string }) {
  return (
    <>
      <Text className="text-3xl font-bold text-foreground mb-5">
        {t('onboarding.howTitle')}
      </Text>
      {[
        ['📝', t('onboarding.pickTopicTitle'), t('onboarding.pickTopicBody')],
        ['🤖', t('onboarding.aiCardsTitle'), t('onboarding.aiCardsBody')],
        ['✍️', t('onboarding.practiceTitle'), t('onboarding.practiceBody')],
      ].map(([icon, title, desc]) => (
        <View key={title} className="flex-row mb-5">
          <Text className="text-2xl mr-3">{icon}</Text>
          <View className="flex-1">
            <Text className="text-foreground font-semibold text-base mb-1">{title}</Text>
            <Text className="text-foreground-secondary text-sm leading-5">{desc}</Text>
          </View>
        </View>
      ))}
    </>
  );
});

// ─── Hidden backend override ─────────────────────────────────────────────────

function shouldDefaultBackendToHttp(input: string): boolean {
  const host = input.split('/')[0].split(':')[0].toLowerCase();
  return (
    /^[\d.]+$/.test(host) ||
    host === 'localhost' ||
    !host.includes('.') ||
    host.endsWith('.local') ||
    host.endsWith('.nord')
  );
}

function normalizeBackendInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const hasScheme = /^https?:\/\//i.test(trimmed);
    const withScheme = hasScheme ? trimmed : `${shouldDefaultBackendToHttp(trimmed) ? 'http' : 'https'}://${trimmed}`;
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    if (!hasScheme && !url.port && url.protocol === 'http:') url.port = '3001';
    url.pathname = '/api/v1';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function BackendHostModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const [backendInput, setBackendInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    getBackendBaseUrl().then(url => {
      if (!mounted) return;
      setBackendInput(url?.replace(/^https?:\/\//, '').replace(/\/api\/v1$/, '') ?? '');
      setMessage(null);
    });
    return () => { mounted = false; };
  }, [visible]);

  async function handleSave() {
    const baseUrl = normalizeBackendInput(backendInput);
    if (!baseUrl) {
      setMessage('Enter a valid IP or URL.');
      return;
    }
    await setBackendBaseUrl(baseUrl);
    setMessage(`Saved ${baseUrl}`);
    onClose();
  }

  async function handleClear() {
    await clearBackendBaseUrl();
    setBackendInput('');
    setMessage('Cleared.');
  }

  async function handleTest() {
    const baseUrl = normalizeBackendInput(backendInput);
    if (!baseUrl) {
      setMessage('Enter a valid IP or URL.');
      return;
    }
    setMessage('Testing...');
    try {
      const resolvedBaseUrl = resolveBackendBaseUrlForPlatform(baseUrl);
      const res = await fetch(`${resolvedBaseUrl}/health`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(`HTTP ${res.status}`);
        return;
      }
      setMessage(body?.status === 'ok' ? `OK: ${resolvedBaseUrl}` : 'Connected, but unexpected response.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Network request failed.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          className="bg-surface rounded-2xl p-5 border border-border"
          style={styles.backendModalCard}
          onPress={e => e.stopPropagation()}
        >
          <Text className="text-foreground text-lg font-bold mb-2">Backend IP</Text>
          <Text className="text-foreground-secondary text-sm leading-5 mb-4">
            Enter your Mac&apos;s Meshnet/LAN IP or a backend URL.
          </Text>
          <TextInput
            className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm font-mono"
            placeholder="100.86.5.173"
            placeholderTextColor={colors.foreground_muted}
            value={backendInput}
            onChangeText={setBackendInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {message && (
            <Text className="text-foreground-secondary text-xs mt-2">{message}</Text>
          )}
          <View className="flex-row gap-3 mt-5">
            <TouchableOpacity className="flex-1 py-3 rounded-xl border border-border items-center" onPress={handleClear}>
              <Text className="text-foreground/80 font-semibold">Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-1 py-3 rounded-xl border border-border items-center" onPress={handleTest}>
              <Text className="text-foreground/80 font-semibold">Test</Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-1 py-3 rounded-xl bg-primary items-center" onPress={handleSave}>
              <Text className="text-primary-foreground font-semibold">Save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(false);
  const [apiKey, setApiKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [accountSuccess, setAccountSuccess] = useState(false);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [backendModalVisible, setBackendModalVisible] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const stepRef = useRef(0);
  const cardRef = useRef<View>(null);
  const backgroundTapCount = useRef(0);
  const backgroundTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerWidthRef = useRef(0);
  const heights = useRef<number[]>(Array(TOTAL_STEPS).fill(0));
  const cardAnimX = useRef(new Animated.Value(0)).current;
  const cardShakeX = useRef(new Animated.Value(0)).current;
  const heightAnim = useRef(new Animated.Value(200)).current;

  useEffect(() => {
    analytics.track('onboarding_started');
  }, []);

  function onPanelLayout(index: number, h: number) {
    heights.current[index] = h;
    if (stepRef.current === index) heightAnim.setValue(h);
  }

  function goToStep(nextStep: number) {
    if (nextStep === stepRef.current || !containerWidthRef.current) return;
    Keyboard.dismiss();
    setError(null);
    if (showApiKeyForm) setShowApiKeyForm(false);
    if (showForgotPassword) { setShowForgotPassword(false); setForgotSent(false); }
    const pw = containerWidthRef.current;
    stepRef.current = nextStep;
    Animated.parallel([
      Animated.timing(cardAnimX, { toValue: -nextStep * pw, duration: 350, useNativeDriver: true }),
      Animated.timing(heightAnim, { toValue: heights.current[nextStep] || 200, duration: 350, useNativeDriver: false }),
    ]).start(() => setStep(nextStep));
  }

  function shakeCard() {
    cardShakeX.stopAnimation();
    cardShakeX.setValue(0);
    Animated.sequence([
      Animated.timing(cardShakeX, { toValue: -4, duration: 55, useNativeDriver: true }),
      Animated.timing(cardShakeX, { toValue: 4, duration: 75, useNativeDriver: true }),
      Animated.timing(cardShakeX, { toValue: -2, duration: 65, useNativeDriver: true }),
      Animated.timing(cardShakeX, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }

  async function handleSubmitAccount() {
    if (!email.trim() || !password.trim()) {
      setError(t('onboarding.missingCredentials'));
      shakeCard();
      return;
    }
    if (!isLogin) {
      const emailErr = validateEmail(email);
      if (emailErr) { setError(emailErr); shakeCard(); return; }
      const pwErr = validatePassword(password.trim());
      if (pwErr) { setError(pwErr); shakeCard(); return; }
    }
    setError(null);
    setLoading(true);
    try {
      const minWait = new Promise(r => setTimeout(r, 1200));
      const [result] = await Promise.all([
        isLogin
          ? login(email.trim(), password.trim())
          : register(email.trim(), password.trim()),
        minWait,
      ]);
      await setAuthToken(result.token);
      await setUserId(result.user.id);
      if (result.user.email) await setUserEmail(result.user.email);
      analytics.identify(result.user.id, { auth_method: 'email', email: result.user.email ?? undefined });
      if (!isLogin) {
        analytics.track('onboarding_completed', { auth_method: 'email', auth_flow: 'register' });
      }
      setLoading(false);
      setAccountSuccess(true);
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : t('common.errorGeneric'));
      shakeCard();
    }
  }

  async function handleForgotSubmit() {
    const trimmed = email.trim();
    const emailErr = validateEmail(trimmed);
    if (!trimmed || emailErr) { setError(emailErr ?? 'Please enter a valid email address.'); return; }
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(trimmed);
      setForgotSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitKey() {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError(t('onboarding.enterApiKey'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await validateApiKey(trimmed);
      if (!result.valid) {
        setError(t('onboarding.keyVerifyFailed', { error: result.error ?? t('deck.unknownError') }));
        return;
      }
      await setApiKey(trimmed);
      await hydrateSettings();
      router.replace('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  const [centralKeyAvailable, setCentralKeyAvailable] = useState(false);

  const handlePostAccountNext = useCallback(async () => {
    setLoading(true);
    try {
      const me = await getMe();
      await setUserId(me.id);
      await setUserRole(me.role);
      analytics.identify(me.id, {
        has_api_key: me.hasApiKey,
        central_key_available: me.centralKeyAvailable,
        auth_methods: me.authMethods,
        email: me.email ?? undefined,
      });
      await hydrateSettings();
      setCentralKeyAvailable(me.centralKeyAvailable);
      if (me.hasApiKey || me.centralKeyAvailable) {
        router.replace('/home');
        return;
      }
    } catch {
      // If check fails, just show the API key form
    } finally {
      setLoading(false);
    }
    setError(null);
    setShowApiKeyForm(true);
  }, [router]);

  useEffect(() => {
    if (accountSuccess && isLogin) {
      const timer = setTimeout(() => handlePostAccountNext(), 1500);
      return () => clearTimeout(timer);
    }
  }, [accountSuccess, isLogin, handlePostAccountNext]);

  const isForgotStep = step === 2 && showForgotPassword;
  const isAccountStep = step === 2 && !showApiKeyForm && !showForgotPassword;
  const isApiKeyStep = step === 2 && showApiKeyForm;
  const canGoBack = step > 0 || showApiKeyForm || showForgotPassword;

  function handleBack() {
    if (showForgotPassword) {
      setShowForgotPassword(false);
      setForgotSent(false);
      setError(null);
    } else if (showApiKeyForm) {
      setShowApiKeyForm(false);
      setError(null);
    } else {
      goToStep(step - 1);
    }
  }

  const registerBackgroundTap = useCallback(() => {
    if (!BACKEND_DEBUG_UI_ENABLED) return;
    if (backgroundTapTimer.current) clearTimeout(backgroundTapTimer.current);
    backgroundTapCount.current += 1;
    if (backgroundTapCount.current >= 10) {
      backgroundTapCount.current = 0;
      setBackendModalVisible(true);
      return;
    }
    backgroundTapTimer.current = setTimeout(() => {
      backgroundTapCount.current = 0;
    }, 2500);
  }, []);

  const handleRootTouchEnd = useCallback((event: any) => {
    if (!BACKEND_DEBUG_UI_ENABLED) return;
    if (backendModalVisible) return;
    const { pageX, pageY } = event.nativeEvent;
    cardRef.current?.measureInWindow((x, y, width, height) => {
      const insideCard =
        pageX >= x &&
        pageX <= x + width &&
        pageY >= y &&
        pageY <= y + height;
      if (!insideCard) registerBackgroundTap();
    });
  }, [backendModalVisible, registerBackgroundTap]);

  const swipe = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-10, 10])
    .runOnJS(true)
    .onEnd(e => {
      if (e.translationX < -50 && stepRef.current < TOTAL_STEPS - 1) goToStep(stepRef.current + 1);
      else if (e.translationX > 50 && stepRef.current > 0) goToStep(stepRef.current - 1);
    });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      onTouchEndCapture={handleRootTouchEnd}
    >
      <OnboardingBackground />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Card */}
        <View ref={cardRef} className="w-full max-w-md bg-surface rounded-3xl p-8 shadow-2xl">
          <Animated.View style={{ transform: [{ translateX: cardShakeX }] }}>

          {/* Step dots */}
          <View className="flex-row mb-8 gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <TouchableOpacity key={i} className="flex-1 py-2" onPress={() => goToStep(i)} activeOpacity={0.7}>
                <View className={`h-1.5 rounded-full ${i === step ? 'bg-primary' : 'bg-background-muted'}`} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Card body */}
          <GestureDetector gesture={swipe}>
            <Animated.View
              style={{ height: heightAnim, overflow: 'hidden' }}
              onLayout={e => { containerWidthRef.current = e.nativeEvent.layout.width; }}
            >
              <Animated.View style={{ flexDirection: 'row', width: `${TOTAL_STEPS * 100}%`, transform: [{ translateX: cardAnimX }] }}>
                {([
                  <WelcomeCard key="welcome" t={t} />,
                  <HowItWorksCard key="how-it-works" t={t} />,
                  showForgotPassword
                    ? <ForgotPasswordCard key="forgot-card" email={email} onEmailChange={setEmail} error={step === 2 ? error : null} loading={loading} sent={forgotSent} />
                    : showApiKeyForm
                      ? <ApiKeyCard key="api-key-card" apiKey={apiKey} onApiKeyChange={setApiKeyInput} error={error} loading={loading} canSkip={centralKeyAvailable} onSkip={() => { analytics.track('onboarding_skipped_api_key'); router.replace('/home'); }} />
                      : <AccountCard key="account-card" email={email} onEmailChange={setEmail} password={password} onPasswordChange={setPassword} error={step === 2 ? error : null} loading={loading} isLogin={isLogin} onToggleMode={() => setIsLogin(v => !v)} onSubmit={handleSubmitAccount} onForgotPassword={() => { setShowForgotPassword(true); setForgotSent(false); setError(null); }} success={accountSuccess} />,
                ] as const).map((panel, i) => (
                  <View key={i} style={{ width: `${100 / TOTAL_STEPS}%` }} onLayout={e => onPanelLayout(i, e.nativeEvent.layout.height)}>
                    {panel}
                  </View>
                ))}
              </Animated.View>
            </Animated.View>
          </GestureDetector>

          {/* Navigation */}
          <View className="flex-row mt-8 gap-3">
            <TouchableOpacity
              className={`flex-1 py-3.5 rounded-xl border border-border items-center ${canGoBack ? '' : 'opacity-0'}`}
              onPress={handleBack}
              disabled={!canGoBack || loading}
              accessibilityElementsHidden={!canGoBack}
              importantForAccessibility={canGoBack ? 'auto' : 'no-hide-descendants'}
            >
              <Text className="text-foreground/80 font-semibold">{t('common.back')}</Text>
            </TouchableOpacity>
            {isForgotStep ? (
              !forgotSent ? (
                <TouchableOpacity
                  className={`flex-1 py-3.5 rounded-xl items-center ${loading ? 'bg-primary/70' : 'bg-primary'}`}
                  onPress={handleForgotSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-primary-foreground font-semibold">{t('onboarding.sendLink')}</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <View className="flex-1" />
              )
            ) : isApiKeyStep ? (
              <TouchableOpacity
                className={`flex-1 py-3.5 rounded-xl items-center ${loading ? 'bg-primary/70' : 'bg-primary'}`}
                onPress={handleSubmitKey}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-primary-foreground font-semibold">{t('common.verifyContinue')}</Text>
                )}
              </TouchableOpacity>
            ) : isAccountStep ? (
              accountSuccess ? (
                <RainbowButton onPress={handlePostAccountNext} label={isLogin ? t('onboarding.redirecting') : t('common.next')} />
              ) : (
                <TouchableOpacity
                  className={`flex-1 py-3.5 rounded-xl items-center ${loading ? 'bg-primary/70' : 'bg-primary'}`}
                  onPress={handleSubmitAccount}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-primary-foreground font-semibold">{isLogin ? t('onboarding.signIn') : t('onboarding.createAccount')}</Text>
                  )}
                </TouchableOpacity>
              )
            ) : (
              <TouchableOpacity
                className="flex-1 py-3.5 rounded-xl bg-primary items-center"
                onPress={() => goToStep(step + 1)}
              >
                <Text className="text-primary-foreground font-semibold">{t('common.next')}</Text>
              </TouchableOpacity>
            )}
          </View>
          </Animated.View>
        </View>
      </ScrollView>
      {BACKEND_DEBUG_UI_ENABLED && (
        <BackendHostModal visible={backendModalVisible} onClose={() => setBackendModalVisible(false)} />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backendModalCard: {
    width: '100%',
    maxWidth: 420,
  },
  welcomeBrand: {
    marginBottom: 24,
  },
});
