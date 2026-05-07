import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';

import { NeedsConfirmationButton } from '@/components/NeedsConfirmationButton';
import { DatePicker } from '@/components/pickers/DatePicker';
import { formatLocalDateToYmd } from '@/components/pickers/dateUtils';
import { useColors } from '@/constants/theme';
import { resetDeckToNeverStudied, setDeckDueDate } from '@/lib/api';
import type { TreeNode } from '@/lib/types';
import { useI18n } from '@/lib/i18n';

interface ReviewScheduleSectionProps {
  node: TreeNode;
  onScheduleChanged?: () => void;
  onReviewsChanged?: () => void;
}

export function ReviewScheduleSection({
  node,
  onScheduleChanged,
  onReviewsChanged,
}: ReviewScheduleSectionProps) {
  const colors = useColors();
  const { t } = useI18n();
  const [dueDate, setDueDateState] = useState(
    node.deck?.dueAt ? formatLocalDateToYmd(new Date(node.deck.dueAt)) : ''
  );

  useEffect(() => {
    setDueDateState(node.deck?.dueAt ? formatLocalDateToYmd(new Date(node.deck.dueAt)) : '');
  }, [node]);

  async function handleDateChange(value: string) {
    setDueDateState(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    await setDeckDueDate(node.id, value);
    onScheduleChanged?.();
    onReviewsChanged?.();
  }

  async function handleReset() {
    setDueDateState('');
    await resetDeckToNeverStudied(node.id);
    onScheduleChanged?.();
    onReviewsChanged?.();
  }

  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-4 gap-2">
      <Text className="text-foreground/80 text-sm font-medium">{t('history.reviewSchedule')}</Text>
      <DatePicker
        value={dueDate}
        onChange={handleDateChange}
        placeholder={t('picker.pickDueDate')}
        popoverPlacement="below"
        popoverTitle={t('picker.dueDate')}
        popoverFooter={
          <NeedsConfirmationButton
            label={t('picker.resetToNeverStudied')}
            confirmLabel={t('picker.tapAgainReset')}
            onConfirm={handleReset}
            destructive
          />
        }
        androidNeutralButton={{
          label: t('common.reset'),
          textColor: colors.error,
          onPress: handleReset,
        }}
      />
    </View>
  );
}
