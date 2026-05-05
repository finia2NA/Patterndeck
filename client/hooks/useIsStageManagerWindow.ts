import { Dimensions, Platform, useWindowDimensions } from 'react-native';

/**
 * Returns true when running in an iPadOS Stage Manager floating window
 * (i.e. the app window is smaller than the physical screen).
 * Always false on iPhone, Android, and web.
 */
export function useIsStageManagerWindow(): boolean {
  const { width, height } = useWindowDimensions();

  if (Platform.OS !== 'ios') return false;

  const screen = Dimensions.get('screen');
  return width < screen.width || height < screen.height;
}
