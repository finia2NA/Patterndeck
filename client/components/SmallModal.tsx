import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useColors } from '@/constants/theme';

interface SmallModalProps {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
  maxWidth?: number;
}

export function SmallModal({ visible, onDismiss, children, maxWidth = 380 }: SmallModalProps) {
  const colors = useColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View className="flex-1" style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View className="flex-1 items-center justify-center px-6" pointerEvents="box-none">
          <View
            className="w-full rounded-2xl border p-5"
            style={[
              styles.card,
              {
                maxWidth,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
  },
});
