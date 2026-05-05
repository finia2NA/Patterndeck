import { type ReactNode, useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  Animated,
  StyleSheet,
  Appearance,
  Platform,
  type ColorSchemeName,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScreenSize } from '@/hooks/useScreenSize';
import { dark, darkThemeVars, light, lightThemeVars } from '@/constants/theme';
import { PageSheetScrollContext } from '@/components/PageSheetScrollContext';
import { PlatformButton } from '@/components/PlatformButton';

interface PageSheetModalProps {
  visible: boolean;
  title: string;
  cancelText: string;
  onCancel: () => void;
  confirmText?: string;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
  confirmCloses?: boolean;
  confirmConfirmationTitle?: string;
  confirmConfirmationMessage?: string;
  confirmConfirmationActionText?: string;
  confirmConfirmationDestructive?: boolean;
  children: ReactNode;
}

function resolveColorScheme(scheme: ColorSchemeName | null | undefined): 'light' | 'dark' {
  return scheme === 'light' ? 'light' : 'dark';
}

export function PageSheetModal({
  visible,
  title,
  cancelText,
  onCancel,
  confirmText,
  onConfirm,
  confirmDisabled = false,
  confirmCloses = true,
  confirmConfirmationTitle,
  confirmConfirmationMessage,
  confirmConfirmationActionText,
  confirmConfirmationDestructive = false,
  children,
}: PageSheetModalProps) {
  const insets = useSafeAreaInsets();
  const { height, isSmallScreen } = useScreenSize();
  const [scheme, setScheme] = useState<'light' | 'dark'>(resolveColorScheme(Appearance.getColorScheme()));
  const isScrollingRef = useRef(false);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setScheme(resolveColorScheme(colorScheme));
    });
    return () => sub.remove();
  }, []);

  const themeVars = scheme === 'dark' ? darkThemeVars : lightThemeVars;
  const colors = scheme === 'dark' ? dark : light;
  const headerButtonBackground = Platform.OS === 'ios'
    ? (scheme === 'dark' ? colors.background_muted : colors.background_warm)
    : undefined;
  const headerButtonColor = Platform.OS === 'ios' ? colors.foreground : colors.primary;
  const confirmButtonColor = colors.primary;
  const cancelButtonWidth = estimateHeaderButtonWidth(cancelText);
  const confirmButtonWidth = confirmText ? estimateHeaderButtonWidth(confirmText) : 0;
  const headerSideWidth = Math.max(cancelButtonWidth, confirmButtonWidth);

  // Web-only: keep Modal mounted while exit animation plays.
  const [shown, setShown] = useState(false);
  const slideY = useRef(new Animated.Value(height)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (visible) {
      setShown(true);
      slideY.setValue(height);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(slideY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 30,
          stiffness: 300,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
    if (!visible) setShown(false);
  }, [visible, height, slideY, backdropOpacity]);

  const animateOut = useCallback((then: () => void) => {
    if (Platform.OS !== 'web') {
      then();
      return;
    }
    Animated.parallel([
      Animated.timing(slideY, {
        toValue: height,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShown(false);
      then();
    });
  }, [height, slideY, backdropOpacity]);

  const handleCancel = useCallback(() => {
    animateOut(onCancel);
  }, [onCancel, animateOut]);

  const handleConfirm = useCallback(() => {
    if (!onConfirm || confirmDisabled) return;
    if (confirmCloses) animateOut(onConfirm);
    else onConfirm();
  }, [onConfirm, confirmDisabled, confirmCloses, animateOut]);

  const makeHeader = (paddingTop: number) => (
    <View
      className="flex-row items-center border-b border-border"
      style={{ paddingHorizontal: 24, paddingTop, paddingBottom: 8 }}
    >
      <View style={[styles.headerSideLeft, { width: headerSideWidth }]}>
        <PlatformButton
          text={cancelText}
          onPress={handleCancel}
          variant="glass"
          color={headerButtonColor}
          backgroundColor={headerButtonBackground}
          style={[styles.headerButton, { width: cancelButtonWidth }]}
          textStyle={styles.cancelText}
          fontSize={16}
          horizontalPadding={14}
          verticalPadding={7}
          cornerRadius={18}
        />
      </View>

      <Text className="flex-1 text-center text-foreground text-lg font-bold" numberOfLines={1}>
        {title}
      </Text>

      {confirmText ? (
        <View style={[styles.headerSideRight, { width: headerSideWidth }]}>
          <PlatformButton
            text={confirmText}
            onPress={handleConfirm}
            disabled={confirmDisabled}
            variant="glass"
            color={confirmButtonColor}
            backgroundColor={headerButtonBackground}
            disabledColor={colors.foreground_secondary}
            style={[styles.headerButton, { width: confirmButtonWidth }]}
            textStyle={styles.confirmText}
            fontSize={16}
            fontWeight="semibold"
            horizontalPadding={14}
            verticalPadding={7}
            cornerRadius={18}
            confirmationTitle={confirmConfirmationTitle}
            confirmationMessage={confirmConfirmationMessage}
            confirmationActionText={confirmConfirmationActionText}
            confirmationDestructive={confirmConfirmationDestructive}
          />
        </View>
      ) : (
        <View style={{ width: headerSideWidth }} />
      )}
    </View>
  );

  const scrollView = (paddingBottom: number) => (
    <PageSheetScrollContext.Provider value={isScrollingRef}>
      <KeyboardAwareScrollView
        style={styles.bodyScroll}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 16,
          paddingBottom,
        }}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => { isScrollingRef.current = true; }}
        onScrollEndDrag={() => { setTimeout(() => { isScrollingRef.current = false; }, 80); }}
        onMomentumScrollEnd={() => { isScrollingRef.current = false; }}
      >
        {children}
      </KeyboardAwareScrollView>
    </PageSheetScrollContext.Provider>
  );

  // Native: delegate presentation entirely to iOS/Android — swipe-to-dismiss and
  // resize behaviour are handled by the platform.
  if (Platform.OS !== 'web') {
    return (
      <Modal
        visible={visible}
        transparent={false}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCancel}
      >
        <View style={[styles.container, themeVars]} className="bg-background">
          {makeHeader(insets.top + 8)}
          {scrollView(insets.bottom + 24)}
        </View>
      </Modal>
    );
  }

  // Web: custom animated sheet with backdrop.
  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={handleCancel}
    >
      <View style={[styles.overlay, isSmallScreen ? styles.overlaySmall : styles.overlayLarge, themeVars]}>
        {!isSmallScreen && (
          <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel}>
            <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
          </Pressable>
        )}

        <Animated.View
          style={[
            isSmallScreen ? styles.sheet : styles.card,
            { transform: [{ translateY: slideY }] },
            isSmallScreen ? undefined : { height: Math.min(height * 0.88, 680) },
          ]}
        >
          <View
            className={isSmallScreen ? 'flex-1 bg-background' : 'bg-background rounded-2xl overflow-hidden'}
            style={isSmallScreen ? styles.sheetContainer : styles.cardContainer}
          >
            {makeHeader(isSmallScreen ? insets.top + 8 : 12)}
            {scrollView(isSmallScreen ? insets.bottom + 24 : 24)}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
  },
  overlayLarge: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlaySmall: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    marginHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 24,
  },
  sheetContainer: {
    flex: 1,
    maxHeight: '100%',
  },
  cardContainer: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    width: '100%',
  },
  bodyScroll: {
    flex: 1,
  },
  cancelText: {
    fontSize: 16,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerSideLeft: {
    alignItems: 'flex-start',
  },
  headerSideRight: {
    alignItems: 'flex-end',
  },
  headerButton: {
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

function estimateHeaderButtonWidth(label: string) {
  return Math.max(88, Math.min(132, label.length * 9 + 48));
}
