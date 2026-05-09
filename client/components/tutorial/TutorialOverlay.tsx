import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Animated, Platform, Dimensions, Modal, InteractionManager,
} from 'react-native';
import { useColors } from '@/constants/theme';
import { useI18n } from '@/lib/i18n';

export interface TutorialStep {
  ref: React.RefObject<View | null>;
  title: string;
  body: string;
}

export interface TutorialIntro {
  title: string;
  body: string;
  startLabel?: string;
}

interface Rect { x: number; y: number; width: number; height: number }

interface TutorialOverlayProps {
  steps: TutorialStep[];
  visible: boolean;
  onDone: () => void;
  intro?: TutorialIntro;
  /** Extra ms to wait before measuring targets — use in sheet/modal contexts where animations need to settle */
  measureDelay?: number;
}

const CARD_W = 288;
const INTRO_CARD_W = 320;
const GAP = 16;
const CARD_H_EST = 195;
const INTRO_CARD_H_EST = 222;

export function TutorialOverlay({ steps, visible, onDone, intro, measureDelay = 80 }: TutorialOverlayProps) {
  const colors = useColors();
  const { t } = useI18n();

  // displayStep drives navigation; contentStep drives what's rendered (updates when spring starts)
  const [displayStep, setDisplayStep] = useState(() => intro ? -1 : 0);
  const [contentStep, setContentStep] = useState(() => intro ? -1 : 0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(CARD_H_EST);

  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const displayStepRef = useRef(displayStep);
  displayStepRef.current = displayStep;

  // Position — JS driver (left/top cannot use native driver)
  const animX = useRef(new Animated.Value(GAP)).current;
  const animY = useRef(new Animated.Value(GAP)).current;

  // Pop-in on first appearance only — native driver
  const cardScale = useRef(new Animated.Value(0.88)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const hasPopped = useRef(false);

  // Pop-in fires exactly once when the overlay first becomes visible
  useEffect(() => {
    if (!visible) {
      hasPopped.current = false;
      cardScale.setValue(0.88);
      cardOpacity.setValue(0);
      return;
    }
    if (hasPopped.current) return;
    hasPopped.current = true;
    Animated.parallel([
      Animated.spring(cardScale, { toValue: 1, friction: 7, tension: 68, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [visible, cardScale, cardOpacity]);

  // Measure target element
  useEffect(() => {
    if (!visible) {
      setDisplayStep(intro ? -1 : 0);
      setContentStep(intro ? -1 : 0);
      setRect(null);
      return;
    }

    if (displayStep === -1) {
      const { width: sw, height: sh } = Dimensions.get('window');
      animX.setValue(Math.max(GAP, (sw - INTRO_CARD_W) / 2));
      animY.setValue(Math.max(GAP, (sh - INTRO_CARD_H_EST) / 2));
      setRect(null);
      setContentStep(-1);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        const target = stepsRef.current[displayStep]?.ref?.current;
        if (!target) {
          setContentStep(displayStepRef.current);
          setRect(null);
          return;
        }
        target.measureInWindow((x, y, width, height) => {
          if (cancelled) return;
          if (width > 0 && height > 0) setRect({ x, y, width, height });
          else {
            setContentStep(displayStepRef.current);
            setRect(null);
          }
        });
      }, measureDelay);
    });

    return () => {
      cancelled = true;
      handle.cancel();
      clearTimeout(timeoutId);
    };
  }, [visible, displayStep, intro, animX, animY, measureDelay]);

  // Re-measure on window resize
  useEffect(() => {
    if (!visible || displayStep === -1) return;
    const sub = Dimensions.addEventListener('change', () => {
      const target = stepsRef.current[displayStep]?.ref?.current;
      if (!target) return;
      target.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) setRect({ x, y, width, height });
      });
    });
    return () => sub.remove();
  }, [visible, displayStep]);

  // Re-center intro card on resize
  useEffect(() => {
    if (!visible || displayStep !== -1) return;
    const sub = Dimensions.addEventListener('change', ({ window: { width: sw, height: sh } }) => {
      animX.setValue(Math.max(GAP, (sw - INTRO_CARD_W) / 2));
      animY.setValue(Math.max(GAP, (sh - INTRO_CARD_H_EST) / 2));
    });
    return () => sub.remove();
  }, [visible, displayStep, animX, animY]);

  // Spring to measured position — update contentStep as soon as spring begins
  useEffect(() => {
    if (!rect) return;
    // Update text now so it changes while the card is in motion
    setContentStep(displayStepRef.current);
    const { width: sw, height: sh } = Dimensions.get('window');
    const belowY = rect.y + rect.height + GAP;
    const aboveY = rect.y - cardH - GAP;
    const targetY = belowY + cardH < sh - GAP
      ? belowY
      : aboveY > GAP ? aboveY : GAP;
    const targetX = Math.max(GAP, Math.min(
      rect.x + rect.width / 2 - CARD_W / 2,
      sw - CARD_W - GAP
    ));
    Animated.parallel([
      Animated.spring(animX, { toValue: targetX, useNativeDriver: false, friction: 8, tension: 65 }),
      Animated.spring(animY, { toValue: targetY, useNativeDriver: false, friction: 8, tension: 65 }),
    ]).start();
  }, [rect, animX, animY, cardH]);

  if (!visible) return null;

  const dim = 'rgba(0,0,0,0.58)';
  const isIntro = contentStep === -1;
  const isFirst = contentStep === 0;
  const isLast = displayStep === steps.length - 1;
  const currentW = isIntro ? INTRO_CARD_W : CARD_W;

  function handleNext() { isLast ? onDone() : setDisplayStep(s => s + 1); }
  function handleBack() { setDisplayStep(s => Math.max(0, s - 1)); }
  function handleStart() { setDisplayStep(0); }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={{ flex: 1 }} pointerEvents="box-none">
        {/* Background dim / spotlight */}
        {!isIntro && rect ? (
          <>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: Math.max(0, rect.y - 4), backgroundColor: dim }} />
            <View style={{ position: 'absolute', top: rect.y + rect.height + 4, left: 0, right: 0, bottom: 0, backgroundColor: dim }} />
            <View style={{ position: 'absolute', top: rect.y - 4, left: 0, width: Math.max(0, rect.x - 4), height: rect.height + 8, backgroundColor: dim }} />
            <View style={{ position: 'absolute', top: rect.y - 4, left: rect.x + rect.width + 4, right: 0, height: rect.height + 8, backgroundColor: dim }} />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: rect.y - 4, left: rect.x - 4,
                width: rect.width + 8, height: rect.height + 8,
                borderRadius: 10, borderWidth: 2, borderColor: colors.primary,
                ...(Platform.OS === 'web' ? { boxShadow: `0 0 14px ${colors.primary}55` } as object : {}),
              }}
            />
          </>
        ) : (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: dim }} />
        )}

        {/* Floating card — outer: JS-driven position; inner: native-driven scale/opacity */}
        <Animated.View style={{ position: 'absolute', left: animX, top: animY, width: currentW }}>
          <Animated.View
            onLayout={(e) => setCardH(e.nativeEvent.layout.height)}
            style={{
              transform: [{ scale: cardScale }],
              opacity: cardOpacity,
              backgroundColor: colors.surface,
              borderRadius: isIntro ? 20 : 16,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
              ...(Platform.OS === 'web' ? { boxShadow: '0 6px 32px rgba(0,0,0,0.26)' } as object : {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 5 },
                shadowOpacity: 0.24,
                shadowRadius: 16,
                elevation: 12,
              }),
            }}
          >
            {isIntro && (
              <View style={{ height: 4, backgroundColor: colors.primary }} />
            )}

            <View style={{ padding: isIntro ? 22 : 18 }}>
              {!isIntro && (
                <Text style={{ color: colors.foreground_muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 5 }}>
                  {contentStep + 1} / {steps.length}
                </Text>
              )}

              <Text style={{
                color: colors.foreground,
                fontSize: isIntro ? 19 : 15,
                fontWeight: '700',
                marginBottom: isIntro ? 10 : 8,
                lineHeight: isIntro ? 26 : 22,
              }}>
                {isIntro ? intro!.title : steps[contentStep]?.title ?? ''}
              </Text>

              <Text style={{
                color: colors.foreground_secondary,
                fontSize: 13,
                lineHeight: 20,
                marginBottom: isIntro ? 22 : 18,
              }}>
                {isIntro ? intro!.body : steps[contentStep]?.body ?? ''}
              </Text>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  {(isIntro || !isLast) && (
                    <TouchableOpacity onPress={onDone} style={{ paddingHorizontal: 10, paddingVertical: 8 }} activeOpacity={0.7}>
                      <Text style={{ color: colors.foreground_muted, fontSize: 13 }}>
                        {t('tutorial.skip')}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {!isIntro && !isFirst && (
                    <TouchableOpacity
                      onPress={handleBack}
                      style={{
                        paddingHorizontal: 13, paddingVertical: 8,
                        borderRadius: 10, borderWidth: 1, borderColor: colors.border,
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: colors.foreground_secondary, fontSize: 13, fontWeight: '600' }}>
                        {t('common.back')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <TouchableOpacity
                  onPress={isIntro ? handleStart : handleNext}
                  style={{
                    paddingHorizontal: 18, paddingVertical: 9,
                    borderRadius: 10, backgroundColor: colors.primary,
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: colors.primary_foreground, fontSize: 13, fontWeight: '700' }}>
                    {isIntro
                      ? (intro!.startLabel ?? t('tutorial.welcome.start'))
                      : isLast ? t('common.done') : t('common.next')
                    }
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}
