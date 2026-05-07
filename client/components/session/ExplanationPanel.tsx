import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  PanResponder,
  Keyboard,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/constants/theme';
import { GrammarMarkdown } from './GrammarMarkdown';
import { TouchTarget } from '@/components/TouchTarget';
import { useI18n } from '@/lib/i18n';

export const PEEK_HEIGHT = 72;

// ─── Small reusable pieces ────────────────────────────────────────────────────

export function TruncationWarning() {
  const { t } = useI18n();
  return (
    <View className="mt-3 px-3 py-2 bg-background-warm border border-border rounded-lg">
      <Text className="text-xs" style={{ color: '#B87010' }}>{t('session.explanationCutOff')}</Text>
    </View>
  );
}

// ─── Side panel (large screens) ──────────────────────────────────────────────

export function SidePanel({
  topic,
  clarification,
  explanation,
  wasTruncated,
}: {
  topic: string;
  clarification?: string | null;
  explanation: string;
  wasTruncated: boolean;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const [width, setWidth] = useState(320);
  const widthRef = useRef(320);
  const [isDragging, setIsDragging] = useState(false);

  // ── Web: pointer-event drag (mouse + Apple Pencil on iPad web) ─────────────
  function onDragHandlePressWeb(e: any) {
    const startX: number = e.nativeEvent.clientX ?? e.nativeEvent.pageX;
    const startWidth = widthRef.current;
    setIsDragging(true);

    function onPointerMove(ev: PointerEvent) {
      ev.preventDefault();
      const next = Math.max(180, Math.min(600, startWidth + ev.clientX - startX));
      setWidth(next);
      widthRef.current = next;
    }

    function onPointerUp() {
      setIsDragging(false);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  // ── Native (Catalyst, iOS, Android): PanResponder drag ────────────────────
  const dragStartWidthRef = useRef(320);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStartWidthRef.current = widthRef.current;
        setIsDragging(true);
      },
      onPanResponderMove: (_, { dx }) => {
        const next = Math.max(180, Math.min(600, dragStartWidthRef.current + dx));
        setWidth(next);
        widthRef.current = next;
      },
      onPanResponderRelease: () => setIsDragging(false),
    })
  ).current;

  const dragHandleProps = Platform.OS === 'web'
    ? { onStartShouldSetResponder: () => true, onResponderGrant: onDragHandlePressWeb }
    : panResponder.panHandlers;

  return (
    <View style={{ width, flexDirection: 'row', height: '100%' } as any}>
      {/* Panel content */}
      <View className="bg-background flex-1">
        <ScrollView className="flex-1 p-5" showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: insets.top + 40 }}>
          <Text className="text-foreground-secondary text-xs font-semibold uppercase tracking-widest mb-3">
            Grammar Reference
          </Text>
          {!!topic.trim() && (
            <Text className={`text-foreground text-xl font-bold ${clarification?.trim() ? 'mb-2' : 'mb-5'}`}>
              {topic.trim()}
            </Text>
          )}
          {!!clarification?.trim() && (
            <Text className="text-foreground-secondary text-sm italic leading-5 mb-5">
              {clarification.trim()}
            </Text>
          )}
          <GrammarMarkdown>{explanation}</GrammarMarkdown>
          {wasTruncated && <TruncationWarning />}
        </ScrollView>
      </View>

      {/* Drag handle */}
      <View
        {...dragHandleProps}
        style={{
          width: 6,
          cursor: 'col-resize',
          backgroundColor: isDragging ? c.primary : c.background_muted,
          alignItems: 'center',
          justifyContent: 'center',
        } as any}
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: 2,
              height: 2,
              borderRadius: 1,
              backgroundColor: c.primary,
              marginVertical: 2,
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Bottom sheet (small screens) ─────────────────────────────────────────────

export function BottomSheet({
  topic,
  clarification,
  explanation,
  wasTruncated,
}: {
  topic: string;
  clarification?: string | null;
  explanation: string;
  wasTruncated: boolean;
}) {
  const c = useColors();
  const { t } = useI18n();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const animHeight = useRef(new Animated.Value(0)).current;

  // Refs so PanResponder closures always see current values
  const expandedRef = useRef(false);
  const peekH = PEEK_HEIGHT + insets.bottom;
  const expandH = height * 0.65;
  const peekHRef = useRef(peekH);
  const expandHRef = useRef(expandH);
  useEffect(() => { peekHRef.current = peekH; }, [peekH]);
  useEffect(() => { expandHRef.current = expandH; }, [expandH]);

  useEffect(() => {
    Animated.spring(animHeight, { toValue: peekHRef.current, useNativeDriver: false, bounciness: 4 }).start();
  }, [animHeight]);

  function snapTo(open: boolean) {
    expandedRef.current = open;
    setExpanded(open);
    if (open) Keyboard.dismiss();
    Animated.spring(animHeight, {
      toValue: open ? expandHRef.current : peekHRef.current,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  }

  function makePanHandlers(shouldClaim: () => boolean) {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, { dy }) => shouldClaim() && Math.abs(dy) > 5,
      onMoveShouldSetPanResponderCapture: (_, { dy }) => shouldClaim() && Math.abs(dy) > 5,
      onPanResponderGrant: () => { animHeight.stopAnimation(); },
      onPanResponderMove: (_, { dy }) => {
        const base = expandedRef.current ? expandHRef.current : peekHRef.current;
        const next = Math.max(peekHRef.current, Math.min(expandHRef.current, base - dy));
        animHeight.setValue(next);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (vy < -0.5 || dy < -40) snapTo(true);
        else if (vy > 0.5 || dy > 40) snapTo(false);
        else snapTo(expandedRef.current);
      },
    });
  }

  // Collapsed sheet: the whole visible card is a pull-up target.
  const outerPan = useRef(makePanHandlers(() => !expandedRef.current)).current;
  // Header: drag up to expand when collapsed, drag down to collapse when expanded.
  const headerPan = useRef(makePanHandlers(() => true)).current;
  const webCollapsedSelectionProps = Platform.OS === 'web'
    ? {
      style: {
        userSelect: expanded ? 'auto' : 'none',
        WebkitUserSelect: expanded ? 'auto' : 'none',
        cursor: expanded ? 'default' : 'pointer',
      } as object,
    }
    : {};

  return (
    <Animated.View
      {...outerPan.panHandlers}
      {...webCollapsedSelectionProps}
      style={{
        height: animHeight,
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: c.surface,
        borderTopWidth: 1,
        borderTopColor: c.border,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? webCollapsedSelectionProps.style : {}),
      }}
    >
      {/* Handle + header — tap + drag target */}
      <Pressable
        {...headerPan.panHandlers}
        onPress={() => snapTo(!expandedRef.current)}
        style={Platform.OS === 'web' ? { cursor: 'pointer' } as any : undefined}
      >
        <View className="items-center pt-2 pb-1">
          <View className="w-10 h-1 bg-border rounded-full" />
        </View>
        <View className="flex-row items-center justify-between px-5 pb-2">
          <View className="flex-1 pr-3">
            <Text selectable={false} className="text-foreground-secondary text-xs font-semibold uppercase tracking-widest">
              {t('session.grammarReference')}
            </Text>
            {!!topic.trim() && (
              <Text selectable={false} className="text-foreground text-sm font-semibold mt-1" numberOfLines={1}>
                {topic.trim()}
              </Text>
            )}
            {!!clarification?.trim() && (
              <Text selectable={false} className="text-foreground-secondary text-xs italic mt-0.5" numberOfLines={2}>
                {clarification.trim()}
              </Text>
            )}
          </View>
          {expanded && (
            <TouchTarget onPress={() => snapTo(false)} style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
              <Text className="text-foreground-secondary text-xs">{t('session.dismiss')}</Text>
            </TouchTarget>
          )}
        </View>
      </Pressable>

      <ScrollView
        scrollEnabled={expanded}
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {expanded && !!topic.trim() && (
          <Text className={`text-foreground text-xl font-bold ${clarification?.trim() ? 'mb-2' : 'mb-5'}`}>
            {topic.trim()}
          </Text>
        )}
        {expanded && !!clarification?.trim() && (
          <Text className="text-foreground-secondary text-sm italic leading-5 mb-5">
            {clarification.trim()}
          </Text>
        )}
        <GrammarMarkdown>{explanation}</GrammarMarkdown>
        {wasTruncated && <TruncationWarning />}
      </ScrollView>
    </Animated.View>
  );
}
