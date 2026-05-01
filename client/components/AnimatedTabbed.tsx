import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '@/constants/theme';

export interface AnimatedTabbedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface AnimatedTabbedProps<T extends string> {
  tabs: readonly AnimatedTabbedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  variant?: 'subtle' | 'primary';
  className?: string;
}

export function AnimatedTabbed<T extends string>({
  tabs,
  value,
  onChange,
  disabled = false,
  variant = 'subtle',
  className = '',
}: AnimatedTabbedProps<T>) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const selectedIndex = Math.max(0, tabs.findIndex(tab => tab.value === value));
  const tabWidth = tabs.length > 0 && width > 0 ? (width - 8) / tabs.length : 0;
  const isPrimaryVariant = variant === 'primary';

  useEffect(() => {
    if (tabWidth <= 0) return;
    Animated.timing(indicatorX, {
      toValue: selectedIndex * tabWidth,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [indicatorX, selectedIndex, tabWidth]);

  return (
    <View
      className={`flex-row bg-background-muted border border-border rounded-xl p-1 relative ${className}`}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
    >
      {tabWidth > 0 && (
        <Animated.View
          className="rounded-lg"
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 4,
            width: tabWidth,
            borderRadius: 8,
            backgroundColor: isPrimaryVariant ? colors.primary : colors.surface,
            borderColor: colors.primary,
            borderWidth: isPrimaryVariant ? 0 : 1,
            transform: [{ translateX: indicatorX }],
          }}
        />
      )}
      {tabs.map(tab => {
        const selected = tab.value === value;
        const tabDisabled = disabled || tab.disabled;
        const textColor = selected
          ? isPrimaryVariant ? colors.primary_foreground : colors.primary
          : isPrimaryVariant ? colors.primary : colors.foreground_secondary;
        return (
          <TouchableOpacity
            key={tab.value}
            className={`flex-1 py-2.5 rounded-lg items-center ${tabDisabled ? 'opacity-60' : ''}`}
            style={{ zIndex: 1 }}
            onPress={() => {
              if (!selected) onChange(tab.value);
            }}
            disabled={tabDisabled}
            activeOpacity={0.75}
            accessibilityState={{ selected, disabled: tabDisabled }}
          >
            <Text className="text-sm font-semibold" style={{ color: textColor }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
