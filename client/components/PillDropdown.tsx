/**
 * Fallback implementation of PillDropdown (Android + any unhandled platform).
 * Uses a custom inline dropdown. Platform-specific files take priority:
 *   PillDropdown.ios.tsx  — iOS
 *   PillDropdown.web.tsx  — Web
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity, Keyboard } from 'react-native';
import { useColors } from '@/constants/theme';

export interface PillDropdownProps<T extends string | number> {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  formatLabel?: (v: T) => string;
}

export function PillDropdown<T extends string | number>({
  value, options, onChange, formatLabel,
}: PillDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const colors = useColors();
  const label = formatLabel ? formatLabel(value) : String(value);

  return (
    <View style={{ position: 'relative' }}>
      <TouchableOpacity
        className="flex-row items-center gap-1.5 bg-background-muted rounded-lg px-3 py-1.5"
        onPress={() => { Keyboard.dismiss(); setOpen(o => !o); }}
        activeOpacity={0.8}
      >
        <Text className="text-foreground text-sm font-medium">{label}</Text>
        <Text className="text-foreground-secondary text-[10px]">{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open && (
        <>
          {/* Full-screen backdrop — closes the menu on outside tap */}
          <TouchableOpacity
            style={{ position: 'absolute', top: -9999, left: -9999, right: -9999, bottom: -9999 }}
            onPress={() => setOpen(false)}
            activeOpacity={0}
          />
          <View
            className="absolute right-0 rounded-xl shadow-2xl overflow-hidden"
            style={{ top: '100%', marginTop: 4, zIndex: 100, minWidth: 130, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border } as any}
          >
            {options.map((opt) => (
              <TouchableOpacity
                key={String(opt)}
                className={`px-4 py-2.5 ${opt === value ? 'bg-background-muted' : ''}`}
                onPress={() => { onChange(opt); setOpen(false); }}
              >
                <Text className={`text-sm font-medium ${opt === value ? 'text-primary' : 'text-foreground/80'}`}>
                  {formatLabel ? formatLabel(opt) : String(opt)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
