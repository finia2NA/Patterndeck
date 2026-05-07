import { useRef, useEffect } from 'react';
import { View, Text, TextInput, Animated } from 'react-native';
import { useColors } from '@/constants/theme';
import { TouchTarget } from '@/components/TouchTarget';
import { AnimatedTabbed } from '@/components/AnimatedTabbed';
import { useI18n } from '@/lib/i18n';

export interface AccountCardProps {
  email: string;
  onEmailChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  error: string | null;
  loading: boolean;
  isLogin: boolean;
  onToggleMode: () => void;
  onSubmit: () => void;
  onForgotPassword: () => void;
  success: boolean;
}

export function AccountCard({ email, onEmailChange, password, onPasswordChange, error, loading, isLogin, onToggleMode, onSubmit, onForgotPassword, success }: AccountCardProps) {
  const colors = useColors();
  const { t } = useI18n();
  const passwordRef = useRef<TextInput>(null);
  const successOpacity = useRef(new Animated.Value(0)).current;
  const formDim = useRef(new Animated.Value(1)).current;
  const forgotPasswordVisibility = useRef(new Animated.Value(isLogin ? 1 : 0)).current;

  useEffect(() => {
    if (success) {
      Animated.parallel([
        Animated.timing(formDim, { toValue: 0.4, duration: 400, useNativeDriver: true }),
        Animated.timing(successOpacity, { toValue: 1, duration: 500, delay: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [success, formDim, successOpacity]);

  useEffect(() => {
    Animated.timing(forgotPasswordVisibility, {
      toValue: isLogin ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [forgotPasswordVisibility, isLogin]);

  return (
    <>
      <Text className="text-3xl font-bold text-foreground mb-2">
        {success
          ? (isLogin ? t('onboarding.signedInTitle') : t('onboarding.accountCreatedTitle'))
          : t('onboarding.accountTitle')}
      </Text>
      <Text className="text-foreground-secondary text-sm leading-6 mb-6">
        {success
          ? (isLogin
            ? t('onboarding.signedInBody')
            : t('onboarding.accountCreatedBody'))
          : (isLogin
            ? t('onboarding.signInBody')
            : t('onboarding.accountBody'))}
      </Text>

      <Animated.View style={{ opacity: success ? formDim : 1 }}>
        <AnimatedTabbed
          className="mb-5"
          variant="subtle"
          tabs={[
            { value: 'signup', label: t('onboarding.createAccount') },
            { value: 'signin', label: t('onboarding.signIn') },
          ]}
          value={isLogin ? 'signin' : 'signup'}
          onChange={() => onToggleMode()}
          disabled={loading || success}
        />

        <View className="mb-4">
        <Text className="text-foreground/80 text-sm font-medium mb-2">{t('onboarding.email')}</Text>
        <View className="p-1 mb-3">
          <TextInput
            className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm"
            placeholder="you@example.com"
            placeholderTextColor={colors.foreground_muted}
            value={email}
            onChangeText={onEmailChange}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!loading && !success}
          />
        </View>
        <Text className="text-foreground/80 text-sm font-medium mb-2">{t('onboarding.password')}</Text>
        <View className="p-1">
          <TextInput
            ref={passwordRef}
            className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm"
            placeholder={t('onboarding.passwordPlaceholder')}
            placeholderTextColor={colors.foreground_muted}
            value={password}
            onChangeText={onPasswordChange}
            secureTextEntry
            autoCapitalize="none"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            editable={!loading && !success}
          />
        </View>
        </View>
      </Animated.View>

      {success && (
        <Animated.Text style={{ opacity: successOpacity, color: colors.foreground, fontSize: 24, fontWeight: '500', textAlign: 'center', marginTop: 20 }}>
          {t('onboarding.success')}
        </Animated.Text>
      )}

      {error && (
        <Text className="text-error text-xs mt-2">{error}</Text>
      )}
      {!success && (
        <Animated.View
          pointerEvents={isLogin ? 'auto' : 'none'}
          style={{
            height: 36,
            opacity: forgotPasswordVisibility,
            transform: [{
              translateY: forgotPasswordVisibility.interpolate({
                inputRange: [0, 1],
                outputRange: [-4, 0],
              }),
            }],
          }}
        >
          <TouchTarget
            onPress={onForgotPassword}
            disabled={!isLogin || loading}
            style={{ marginTop: 4, paddingHorizontal: 0 }}
          >
            <Text className="text-foreground-secondary text-sm">{t('onboarding.forgotPassword')}</Text>
          </TouchTarget>
        </Animated.View>
      )}
    </>
  );
}
