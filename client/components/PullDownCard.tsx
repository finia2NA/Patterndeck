import { type ReactNode, useMemo } from 'react';
import { Animated, PanResponder, type StyleProp, View, type ViewStyle } from 'react-native';
import { useColors } from '@/constants/theme';

interface PullDownCardProps {
  translateY: Animated.Value;
  onDismiss: () => void;
  onReset?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode | ((handle: ReactNode) => ReactNode);
}

export function PullDownCard({
  translateY,
  onDismiss,
  onReset,
  disabled = false,
  style,
  children,
}: PullDownCardProps) {
  const colors = useColors();
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: (_, { dx, dy }) => (
      !disabled && dy > 4 && Math.abs(dy) > Math.abs(dx)
    ),
    onPanResponderGrant: () => {
      translateY.stopAnimation();
    },
    onPanResponderMove: (_, { dy }) => {
      translateY.setValue(Math.max(0, dy));
    },
    onPanResponderRelease: (_, { dy, vy }) => {
      if (dy > 90 || vy > 0.8) {
        onDismiss();
        return;
      }
      onReset?.();
    },
    onPanResponderTerminate: () => {
      onReset?.();
    },
  }), [disabled, onDismiss, onReset, translateY]);

  const handle = (
    <View
      {...panResponder.panHandlers}
      accessibilityRole="button"
      accessibilityLabel="Pull down to close"
      style={{
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 8,
      }}
    >
      <View
        style={{
          width: 44,
          height: 5,
          borderRadius: 999,
          backgroundColor: colors.foreground_subtle,
          opacity: 0.75,
        }}
      />
    </View>
  );

  return (
    <Animated.View
      style={[
        style,
        { transform: [{ translateY }] },
      ]}
    >
      {typeof children === 'function' ? children(handle) : (
        <>
          {handle}
          {children}
        </>
      )}
    </Animated.View>
  );
}
