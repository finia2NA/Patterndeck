import { useRef, useEffect } from 'react';
import { View, Text, TextInput, Animated } from 'react-native';
import { useColors } from '@/constants/theme';
import { TouchTarget } from '@/components/TouchTarget';
import { AnimatedTabbed } from '@/components/AnimatedTabbed';

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
  const passwordRef = useRef<TextInput>(null);
  const successOpacity = useRef(new Animated.Value(0)).current;
  const formDim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (success) {
      Animated.parallel([
        Animated.timing(formDim, { toValue: 0.4, duration: 400, useNativeDriver: true }),
        Animated.timing(successOpacity, { toValue: 1, duration: 500, delay: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [success, formDim, successOpacity]);

  return (
    <>
      <Text className="text-3xl font-bold text-foreground mb-2">
        {success
          ? (isLogin ? 'Signed in!' : 'Account created!')
          : 'Your account'}
      </Text>
      <Text className="text-foreground-secondary text-sm leading-6 mb-6">
        {success
          ? (isLogin
            ? 'Welcome back — your decks and settings are ready.'
            : 'Your account is set up and ready to go.')
          : (isLogin
            ? 'Sign in with the email and password you used before.'
            : 'Create an account to save your decks and study progress.')}
      </Text>

      {!success && (
        <AnimatedTabbed
          className="mb-5"
          variant="subtle"
          tabs={[
            { value: 'signup', label: 'Create account' },
            { value: 'signin', label: 'Sign in' },
          ]}
          value={isLogin ? 'signin' : 'signup'}
          onChange={() => onToggleMode()}
          disabled={loading}
        />
      )}

      <Animated.View style={{ opacity: success ? formDim : 1 }} className="mb-4">
        <Text className="text-foreground/80 text-sm font-medium mb-2">Email</Text>
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
        <Text className="text-foreground/80 text-sm font-medium mb-2">Password</Text>
        <View className="p-1">
          <TextInput
            ref={passwordRef}
            className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm"
            placeholder="At least 8 characters"
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
      </Animated.View>

      {success && (
        <Animated.Text style={{ opacity: successOpacity, color: colors.foreground, fontSize: 24, fontWeight: '500', textAlign: 'center', marginTop: 20 }}>
          Success!
        </Animated.Text>
      )}

      {error && (
        <Text className="text-error text-xs mt-2">{error}</Text>
      )}
      {!success && (
        <>
          {isLogin && (
            <TouchTarget onPress={onForgotPassword} style={{ marginTop: 4, paddingHorizontal: 0 }}>
              <Text className="text-foreground-secondary text-sm">Forgot password?</Text>
            </TouchTarget>
          )}
        </>
      )}
    </>
  );
}
