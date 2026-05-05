import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, Text, useColorScheme, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlatformButton } from '@/components/PlatformButton';
import { PullDownCard } from '@/components/PullDownCard';
import { useColors } from '@/constants/theme';

export type PlatformPopoverPlacement = 'auto' | 'above' | 'below';

export interface PlatformPopoverTriggerActions {
  open: boolean;
  openPopover: () => void;
  closePopover: () => void;
  togglePopover: () => void;
}

interface PlatformPopoverProps {
  title: string;
  disabled?: boolean;
  placement?: PlatformPopoverPlacement;
  fallbackHeight: number;
  maxWidth: number;
  closeDelay?: number;
  footer?: ReactNode;
  onDone: () => void;
  onCancel?: () => void;
  repositionDeps?: unknown[];
  anchorDisplay?: string;
  sheetHeight?: number;
  minHeight?: number;
  children?: ReactNode;
  trigger: (actions: PlatformPopoverTriggerActions) => ReactNode;
  confirmStyle?: boolean;
  doneLabel?: string;
  message?: string;
  destructive?: boolean;
}

export function PlatformPopover({
  title,
  disabled = false,
  footer,
  onDone,
  onCancel,
  sheetHeight = 420,
  minHeight = 360,
  maxWidth,
  children,
  trigger,
}: PlatformPopoverProps) {
  const colors = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const actionButtonBackground = colors.background_warm;
  const confirmIconColor = scheme === 'light' ? '#FFFFFF' : '#000000';
  const [open, setOpen] = useState(false);
  const sheetY = useRef(new Animated.Value(sheetHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const openPopover = useCallback(() => {
    if (disabled) return;
    sheetY.setValue(sheetHeight);
    backdropOpacity.setValue(0);
    setOpen(true);
  }, [backdropOpacity, disabled, sheetHeight, sheetY]);

  const springSheetOpen = useCallback(() => {
    Animated.spring(sheetY, {
      toValue: 0,
      damping: 24,
      stiffness: 260,
      useNativeDriver: true,
    }).start();
  }, [sheetY]);

  useEffect(() => {
    if (!open || Platform.OS !== 'ios') return;
    Animated.parallel([
      Animated.spring(sheetY, {
        toValue: 0,
        damping: 26,
        stiffness: 260,
        mass: 0.9,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, open, sheetY]);

  const closePopover = useCallback(() => {
    Animated.parallel([
      Animated.timing(sheetY, {
        toValue: sheetHeight,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => setOpen(false));
  }, [backdropOpacity, sheetHeight, sheetY]);

  function handleCancel() {
    onCancel?.();
    closePopover();
  }

  function handleDone() {
    onDone();
    closePopover();
  }

  const actions: PlatformPopoverTriggerActions = {
    open,
    openPopover,
    closePopover,
    togglePopover: open ? closePopover : openPopover,
  };

  return (
    <View>
      {trigger(actions)}

      {open && Platform.OS === 'ios' ? (
        <Modal
          transparent
          visible={open}
          animationType="none"
          onRequestClose={closePopover}
        >
          <Pressable
            style={{ flex: 1, justifyContent: 'flex-end' }}
            onPress={closePopover}
          >
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                backgroundColor: 'rgba(0,0,0,0.35)',
                opacity: backdropOpacity,
              }}
            />
            <PullDownCard
              translateY={sheetY}
              onDismiss={closePopover}
              onReset={springSheetOpen}
              disabled={!open}
              style={{
                marginHorizontal: 12,
                marginBottom: -Math.max(insets.bottom, 18),
                maxWidth,
                width: '100%',
                alignSelf: 'center',
              }}
            >
              {(pullDownHandle) => (
                <Pressable
                  style={{
                    borderTopLeftRadius: 28,
                    borderTopRightRadius: 28,
                    overflow: 'hidden',
                  }}
                  onPress={() => {}}
                >
                  <GlassView
                    glassEffectStyle="regular"
                    colorScheme="auto"
                  >
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderTopLeftRadius: 28,
                        borderTopRightRadius: 28,
                        paddingHorizontal: 14,
                        paddingBottom: Math.max(insets.bottom, 18) + 22,
                        minHeight,
                      }}
                    >
                      {pullDownHandle}
                      <View className="flex-row items-center justify-between mb-4">
                        <PlatformButton
                          icon="close"
                          onPress={handleCancel}
                          variant="prominentGlass"
                          color={colors.foreground}
                          backgroundColor={actionButtonBackground}
                          iconSize={18}
                          accessibilityLabel="Close"
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 24,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        />
                        <Text
                          className="text-foreground font-bold"
                          style={{ fontSize: 16 }}
                        >
                          {title}
                        </Text>
                        <PlatformButton
                          icon="check"
                          onPress={handleDone}
                          variant="prominentGlass"
                          color={confirmIconColor}
                          backgroundColor={colors.primary}
                          iconSize={20}
                          accessibilityLabel="Done"
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 24,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        />
                      </View>

                      {children}

                      {footer ? (
                        <View className="mt-4 mb-5">
                          {footer}
                        </View>
                      ) : null}
                    </View>
                  </GlassView>
                </Pressable>
              )}
            </PullDownCard>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}
