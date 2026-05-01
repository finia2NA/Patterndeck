import { View, Text } from 'react-native';
import { Icon } from '@/components/Icon';
import { useColors } from '@/constants/theme';

export function DueIndicator({ dueAt, isDue }: { dueAt: number | null; isDue: boolean }) {
  const colors = useColors();

  if (dueAt == null) {
    return (
      <View style={{ width: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
        <Icon name="not-started" size={12} color={colors.warning} />
        <Text style={{ color: colors.warning, fontSize: 10 }}>new</Text>
      </View>
    );
  }

  const diffDays = Math.round((dueAt - Date.now()) / 86400000);

  const color = isDue ? colors.error : colors.success;
  const icon = isDue ? 'clock' : 'check';
  const label = diffDays === 0 ? 'today' : `${Math.abs(diffDays)}d`;

  return (
    <View style={{ width: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
      <Icon name={icon} size={12} color={color} />
      <Text style={{ color, fontSize: 10, fontVariant: ['tabular-nums'] }}>{label}</Text>
    </View>
  );
}
