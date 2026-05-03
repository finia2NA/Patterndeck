import { Image } from 'expo-image';
import { Text, View, type ViewStyle } from 'react-native';
import { useColors } from '@/constants/theme';

const logoMark = require('../assets/images/logo-mark.png');

type BrandLogoProps = {
  direction?: 'row' | 'column';
  showWordmark?: boolean;
  size?: number;
  style?: ViewStyle;
  wordmarkSize?: number;
};

export function BrandLogo({
  direction = 'row',
  showWordmark = true,
  size = 36,
  style,
  wordmarkSize = 20,
}: BrandLogoProps) {
  const colors = useColors();

  return (
    <View
      style={[
        {
          alignItems: 'center',
          flexDirection: direction,
          gap: direction === 'row' ? Math.max(8, size * 0.28) : Math.max(6, size * 0.16),
        },
        style,
      ]}
    >
      <Image
        source={logoMark}
        contentFit="contain"
        style={{ width: size, height: size }}
        accessibilityLabel="Pattern Deck logo"
      />
      {showWordmark && (
        <Text
          style={{
            color: colors.foreground,
            fontSize: wordmarkSize,
            fontWeight: '700',
            lineHeight: Math.round(wordmarkSize * 1.15),
          }}
        >
          Pattern Deck
        </Text>
      )}
    </View>
  );
}
