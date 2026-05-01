import { type CSSProperties } from 'react';
import { DayPicker } from 'react-day-picker';
import { useColors } from '@/constants/theme';
import 'react-day-picker/style.css';

interface DatePickerContentProps {
  value?: string;
  draftDate: Date | null;
  month: Date;
  dateTimePickerModule?: any;
  onDraftDateChange: (value: Date) => void;
  onMonthChange: (value: Date) => void;
}

export function DatePickerContent({
  draftDate,
  month,
  onDraftDateChange,
  onMonthChange,
}: DatePickerContentProps) {
  const colors = useColors();
  const dayPickerVars = {
    color: colors.foreground,
    '--rdp-accent-color': colors.primary,
    '--rdp-accent-background-color': `${colors.primary}22`,
    '--rdp-day_button-border-radius': '999px',
    '--rdp-day_button-border': '1px solid transparent',
    '--rdp-selected-border': `1px solid ${colors.primary}`,
    '--rdp-today-color': colors.primary,
    '--rdp-weekday-opacity': '1',
  } as CSSProperties;

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <style>
        {`
          .grammar-crammer-date-picker .rdp-selected {
            font-size: inherit;
          }

          .grammar-crammer-date-picker .rdp-selected .rdp-day_button {
            background: ${colors.primary};
            border-color: ${colors.primary};
            border-radius: 999px;
            color: ${colors.primary_foreground};
            font-weight: 700;
          }

          .grammar-crammer-date-picker .rdp-selected.rdp-today:not(.rdp-outside) .rdp-day_button {
            color: ${colors.primary_foreground};
          }
        `}
      </style>
      <DayPicker
        className="grammar-crammer-date-picker"
        mode="single"
        month={month}
        selected={draftDate ?? undefined}
        onMonthChange={onMonthChange}
        captionLayout="dropdown"
        startMonth={new Date(new Date().getFullYear() - 5, 0)}
        endMonth={new Date(new Date().getFullYear() + 5, 11)}
        onSelect={(next) => {
          if (!next) return;
          onDraftDateChange(next);
        }}
        style={dayPickerVars}
        styles={{
          root: { color: colors.foreground, margin: '0 auto' },
          caption: { color: colors.foreground },
          nav_button: {
            color: colors.foreground,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            background: colors.background_muted,
          },
          dropdown: {
            color: colors.foreground,
            background: colors.background_muted,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
          },
          head_cell: { color: colors.foreground_secondary, fontSize: 12 },
          day: {
            color: colors.foreground,
            borderRadius: 8,
          },
          day_button: {
            borderRadius: 999,
            border: '1px solid transparent',
          },
          day_selected: {
            background: colors.primary,
            color: colors.primary_foreground,
            border: `1px solid ${colors.primary}`,
          },
          day_today: {
            color: colors.primary,
          },
          day_outside: {
            color: colors.foreground_muted,
          },
        }}
      />
    </div>
  );
}
