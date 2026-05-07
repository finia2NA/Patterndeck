import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  Alert,
  Pressable,
} from 'react-native';
import { ThemedSwitch } from '@/components/ThemedSwitch';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { CARD_ORDER_OPTIONS, JUDGE_WITH_EXPLANATION_OPTIONS, FEEDBACK_BREVITY_OPTIONS, KEY_PREFERENCE_OPTIONS, MAX_DECKS_OPTIONS, NEW_DECKS_OPTIONS, UNLIMITED_NEW_DECKS } from '@patterndeck/shared';
import { useColors } from '@/constants/theme';
import { NeedsConfirmationButton } from '@/components/NeedsConfirmationButton';
import { clearAuthToken, clearUserEmail, clearUserId, getUserEmail, getUserId } from '@/lib/storage';
import { deleteApiKey, getUsageStatus, hydrateSettings, parseEnabledLanguages, saveSettings } from '@/lib/api';
import type { UsageStatus } from '@/lib/api';
import { getSettingsSnapshot, resetLocalSettings } from '@/hooks/state/persistent/settingsStore';
import { PillDropdown } from '@/components/PillDropdown';
import { CARD_COUNTS, DEFAULT_LANGUAGES, UI_LOCALES } from '@/constants/session';
import type { CardCount, UiLocale } from '@/constants/session';
import { LanguagePicker } from '@/components/home/LanguagePicker';
import { PageSheetModal } from '@/components/PageSheetModal';
import { platformAlert } from '@/lib/platformAlert';
import { registerCurrentPushDevice, unregisterCurrentPushDevice } from '@/lib/notifications';
import { AnimatedCollapsible } from '@/components/AnimatedCollapsible';
import { TouchTarget } from '@/components/TouchTarget';
import { TimePicker } from '@/components/pickers/TimePicker';
import { normalizeTime } from '@/components/pickers/timeUtils';
import { SectionCard } from './SectionCard';
import { SettingsRow } from './SettingsRow';
import { UsageBar } from './UsageBar';
import { AddApiKeyForm } from './AddApiKeyForm';
import { formatCost } from '@/lib/format';
import { analytics } from '@/lib/analytics';
import { formatUnitCount, resolveUiLocale, useI18n } from '@/lib/i18n';

type CardOrder = 'sequential' | 'shuffled';
type KeyPreference = 'central' | 'own';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const ConfirmButton = NeedsConfirmationButton;
const DEFAULT_CARD_COUNT_OPTIONS = CARD_COUNTS.filter((count) => count !== 0);
const supportsPushNotifications = Platform.OS === 'ios' || Platform.OS === 'android';

export function SettingsModal({ visible, onClose }: SettingsModalProps) {
  const router = useRouter();
  const colors = useColors();
  const { t, localeLabels } = useI18n();
  const [uiLanguage, setUiLanguage] = useState<UiLocale>('en');
  const [cardOrder, setCardOrder] = useState<CardOrder>('shuffled');
  const [caseAwareGeneration, setCaseAwareGeneration] = useState<'on' | 'off'>('on');
  const [judgeWithExplanation, setJudgeWithExplanation] = useState<'on' | 'off'>('on');
  const [feedbackBrevity, setFeedbackBrevity] = useState<'brief' | 'normal'>('normal');
  const [defaultCardCount, setDefaultCardCount] = useState<CardCount>(10);
  const [maxDecksPerSession, setMaxDecksPerSession] = useState(3);
  const [newDecksPerDay, setNewDecksPerDay] = useState(1);
  const [dailyDueTime, setDailyDueTime] = useState('01:00');
  const [notificationsEnabled, setNotificationsEnabled] = useState<'on' | 'off'>('off');
  const [notificationTime, setNotificationTime] = useState('09:00');
  const [enabledLanguages, setEnabledLanguages] = useState<string[]>(DEFAULT_LANGUAGES);
  const [usageStatus, setUsageStatus] = useState<UsageStatus | null>(null);
  const [showAddKey, setShowAddKey] = useState(false);
  const [languagesExpanded, setLanguagesExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notificationSetupBusy, setNotificationSetupBusy] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const accountTapCount = useRef(0);
  const accountTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;

    hydrateSettings().catch(() => { }).finally(() => {
      if (!mounted) return;
      const settings = getSettingsSnapshot();

      setUiLanguage(resolveUiLocale(settings.ui_language));
      if (settings.card_order === 'sequential' || settings.card_order === 'shuffled') setCardOrder(settings.card_order);
      if (settings.case_aware_generation === 'on' || settings.case_aware_generation === 'off') setCaseAwareGeneration(settings.case_aware_generation);
      if (settings.judge_with_explanation === 'on' || settings.judge_with_explanation === 'off') setJudgeWithExplanation(settings.judge_with_explanation);
      if (settings.feedback_brevity === 'brief' || settings.feedback_brevity === 'normal') setFeedbackBrevity(settings.feedback_brevity);

      const n = settings.default_card_count ? parseInt(settings.default_card_count, 10) : 10;
      setDefaultCardCount(CARD_COUNTS.includes(n as CardCount) && n !== 0 ? n as CardCount : 10);
      const m = settings.max_decks_per_session ? parseInt(settings.max_decks_per_session, 10) : 3;
      setMaxDecksPerSession((MAX_DECKS_OPTIONS as readonly number[]).includes(m) ? m : 3);
      const nd = settings.new_decks_per_day ? parseInt(settings.new_decks_per_day, 10) : 1;
      setNewDecksPerDay((NEW_DECKS_OPTIONS as readonly number[]).includes(nd) ? nd : 1);
      setDailyDueTime(normalizeTime(settings.daily_due_time));
      setNotificationsEnabled(settings.notifications_enabled === 'on' ? 'on' : 'off');
      setNotificationTime(normalizeTime(settings.notification_time ?? '09:00'));
      setEnabledLanguages(parseEnabledLanguages(settings.enabled_languages ?? null, DEFAULT_LANGUAGES));
    });

    getUsageStatus().then(status => { if (mounted) setUsageStatus(status); }).catch(() => { });
    getUserEmail().then(email => { if (mounted) setUserEmail(email); }).catch(() => { });
    setShowAddKey(false);
    setSaving(false);

    return () => { mounted = false; };
  }, [visible]);

  function handleChangePreference(next: KeyPreference) {
    if (!usageStatus) return;
    setUsageStatus({ ...usageStatus, preference: next });
  }

  async function handleNotificationsToggle(enabled: boolean) {
    if (!enabled) {
      setNotificationsEnabled('off');
      return;
    }

    setNotificationSetupBusy(true);
    try {
      await registerCurrentPushDevice();
      setNotificationsEnabled('on');
    } catch (e) {
      setNotificationsEnabled('off');
      const message = e instanceof Error ? e.message : 'Unable to enable notifications.';
      platformAlert(t('settings.notificationsUnavailable'), message);
    } finally {
      setNotificationSetupBusy(false);
    }
  }

  async function handleDone() {
    const nextSettings = {
      ...getSettingsSnapshot(),
      ui_language: uiLanguage,
      card_order: cardOrder,
      case_aware_generation: caseAwareGeneration,
      judge_with_explanation: judgeWithExplanation,
      feedback_brevity: feedbackBrevity,
      default_card_count: String(defaultCardCount),
      max_decks_per_session: String(maxDecksPerSession),
      new_decks_per_day: String(newDecksPerDay),
      daily_due_time: normalizeTime(dailyDueTime),
      notifications_enabled: notificationsEnabled,
      notification_time: normalizeTime(notificationTime),
      api_key_preference: usageStatus?.preference ?? getSettingsSnapshot().api_key_preference ?? 'central',
      enabled_languages: JSON.stringify(enabledLanguages),
    };

    setSaving(true);
    try {
      await saveSettings(nextSettings);
      if (notificationsEnabled === 'off') {
        await unregisterCurrentPushDevice().catch(() => { });
      }
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : t('settings.saveFailed');
      platformAlert(t('settings.saveFailed'), message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await unregisterCurrentPushDevice().catch(() => { });
    await clearAuthToken();
    await clearUserId();
    await clearUserEmail();
    analytics.reset();
    resetLocalSettings();
    onClose();
    router.replace('/onboarding');
  }

  async function handleDeleteApiKey() {
    try {
      await deleteApiKey();
    } catch { /* ignore */ }
    if (usageStatus) setUsageStatus({ ...usageStatus, hasOwnKey: false });
    if (!usageStatus?.centralKeyAvailable) {
      onClose();
      router.replace('/onboarding');
    }
  }

  async function handleAccountTitleTap() {
    accountTapCount.current += 1;
    if (accountTapTimer.current) clearTimeout(accountTapTimer.current);
    if (accountTapCount.current >= 10) {
      accountTapCount.current = 0;
      const userId = await getUserId();
      if (userId) {
        await Clipboard.setStringAsync(userId);
        Alert.alert(t('settings.userIdCopied'), userId);
      } else {
        Alert.alert(t('settings.noUserId'));
      }
      return;
    }
    accountTapTimer.current = setTimeout(() => { accountTapCount.current = 0; }, 2000);
  }

  function handleKeyAdded() {
    setShowAddKey(false);
    getUsageStatus().then(setUsageStatus).catch(() => { });
  }

  return (
    <PageSheetModal
      visible={visible}
      title={t('settings.title')}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      confirmText={saving ? t('common.saving') : t('common.done')}
      onConfirm={handleDone}
      confirmDisabled={saving}
      confirmCloses={false}
    >
      <SectionCard title={t('settings.studySettings')}>
        <SettingsRow label={t('settings.uiLanguage')} description={t('settings.uiLanguageDescription')}>
          <PillDropdown value={uiLanguage} options={UI_LOCALES} onChange={setUiLanguage} formatLabel={(v: UiLocale) => localeLabels[v]} />
        </SettingsRow>
        <SettingsRow label={t('settings.collectionCardOrder')} description={t('settings.collectionCardOrderDescription')}>
          <PillDropdown value={cardOrder} options={CARD_ORDER_OPTIONS} onChange={setCardOrder} formatLabel={(v: CardOrder) => v === 'shuffled' ? t('settings.shuffled') : t('settings.sequential')} />
        </SettingsRow>
        <SettingsRow label={t('settings.caseAwareGeneration')} description={t('settings.caseAwareGenerationDescription')}>
          <ThemedSwitch
            value={caseAwareGeneration === 'on'}
            onValueChange={(enabled) => setCaseAwareGeneration(enabled ? 'on' : 'off')}
            disabled={saving}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.contextAwareJudging')} description={t('settings.contextAwareJudgingDescription')}>
          <PillDropdown value={judgeWithExplanation} options={JUDGE_WITH_EXPLANATION_OPTIONS} onChange={setJudgeWithExplanation} formatLabel={(v: 'on' | 'off') => v === 'on' ? t('settings.on') : t('settings.off')} />
        </SettingsRow>
        <SettingsRow label={t('settings.feedbackBrevity')} description={t('settings.feedbackBrevityDescription')}>
          <PillDropdown value={feedbackBrevity} options={FEEDBACK_BREVITY_OPTIONS} onChange={setFeedbackBrevity} formatLabel={(v: 'brief' | 'normal') => v === 'brief' ? t('settings.brief') : t('settings.normal')} />
        </SettingsRow>
        <SettingsRow label={t('settings.defaultCards')} description={t('settings.defaultCardsDescription')}>
          <PillDropdown value={defaultCardCount} options={DEFAULT_CARD_COUNT_OPTIONS} onChange={setDefaultCardCount} formatLabel={(v: CardCount) => formatUnitCount(t, v, 'card', { zeroKey: 'common.inherit' })} />
        </SettingsRow>
        <SettingsRow label={t('settings.maxDecks')} description={t('settings.maxDecksDescription')}>
          <PillDropdown value={maxDecksPerSession} options={MAX_DECKS_OPTIONS} onChange={setMaxDecksPerSession} formatLabel={(v: number) => formatUnitCount(t, v, 'deck')} />
        </SettingsRow>
        <SettingsRow label={t('settings.newDecks')} description={t('settings.newDecksDescription')}>
          <PillDropdown value={newDecksPerDay} options={NEW_DECKS_OPTIONS} onChange={setNewDecksPerDay} formatLabel={(v: number) => formatUnitCount(t, v, 'deck', { infiniteAt: UNLIMITED_NEW_DECKS })} />
        </SettingsRow>
        <SettingsRow label={t('settings.dailyDueTime')} description={t('settings.dailyDueTimeDescription')}>
          <TimePicker value={dailyDueTime} onChange={(next: string) => setDailyDueTime(normalizeTime(next))} />
        </SettingsRow>
      </SectionCard>

      {supportsPushNotifications ? (
        <SectionCard title={t('settings.notifications')}>
          <SettingsRow label={t('settings.dueDeckReminders')} description={t('settings.dueDeckRemindersDescription')}>
            <ThemedSwitch
              value={notificationsEnabled === 'on'}
              onValueChange={handleNotificationsToggle}
              disabled={saving || notificationSetupBusy}
            />
          </SettingsRow>
          <AnimatedCollapsible expanded={notificationsEnabled === 'on'}>
            <SettingsRow label={t('settings.reminderTime')} description={t('settings.reminderTimeDescription')}>
              <TimePicker value={notificationTime} onChange={(next: string) => setNotificationTime(normalizeTime(next))} />
            </SettingsRow>
          </AnimatedCollapsible>
        </SectionCard>
      ) : null}

      <View className="mb-5">
        <Text className="text-foreground/50 text-xs font-semibold uppercase tracking-widest mb-2 px-1">{t('settings.languages')}</Text>
        <View className="h-px bg-border mb-4" />
        <View className="px-1">
          <TouchTarget
            onPress={() => setLanguagesExpanded(e => !e)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 0 }}
          >
            <Text className="text-foreground text-sm font-medium">{languagesExpanded ? t('settings.hideLanguages') : t('settings.showLanguages')}</Text>
            <Text className="text-foreground-secondary text-sm">{languagesExpanded ? '▼' : '▶'}</Text>
          </TouchTarget>
          <AnimatedCollapsible expanded={languagesExpanded} keepMounted={false}>
            <View className="pb-2">
              <Text className="text-foreground-secondary text-xs mb-4">{t('settings.languagesDescription')}</Text>
              <LanguagePicker enabled={enabledLanguages} onChange={setEnabledLanguages} />
            </View>
          </AnimatedCollapsible>
        </View>
      </View>

      {usageStatus && (
        <SectionCard title={t('settings.apiUsage')}>
          {usageStatus.centralKeyAvailable && (
            <Text className="text-foreground-secondary text-xs leading-5 mb-4">{t('settings.includedUsage')}</Text>
          )}
          {usageStatus.centralKeyAvailable && (
            <SettingsRow label={t('settings.keySource')} description={t('settings.keySourceDescription')}>
              <PillDropdown value={usageStatus.preference} options={KEY_PREFERENCE_OPTIONS} onChange={handleChangePreference} formatLabel={(v: KeyPreference) => v === 'central' ? t('settings.serverKey') : t('settings.myOwnKey')} />
            </SettingsRow>
          )}
          {usageStatus.centralKeyAvailable && usageStatus.preference === 'central' && (
            <View className="mb-4">
              <Text className="text-foreground/60 text-xs font-medium mb-2 uppercase tracking-wide">{t('settings.thisMonth')}</Text>
              <UsageBar used={usageStatus.usage.central} limit={usageStatus.userLimit} />
              {usageStatus.globalLimitReached && (
                <Text className="text-xs mt-1" style={{ color: colors.error }}>{t('settings.globalLimitReached')}</Text>
              )}
            </View>
          )}
          {(!usageStatus.centralKeyAvailable || usageStatus.preference === 'own') && (
            <View className="mb-4">
              {usageStatus.hasOwnKey && (
                <View className="mb-3">
                  <Text className="text-foreground/60 text-xs font-medium mb-2 uppercase tracking-wide">{t('settings.thisMonth')}</Text>
                  <Text className="text-foreground-secondary text-xs">{t('settings.used', { amount: formatCost(usageStatus.usage.own) })}</Text>
                </View>
              )}
              {usageStatus.hasOwnKey ? (
                <ConfirmButton label={t('settings.deletePersonalKey')} confirmLabel={t('settings.deletePersonalKeyConfirm')} onConfirm={handleDeleteApiKey} destructive />
              ) : showAddKey ? (
                <AddApiKeyForm onAdded={handleKeyAdded} />
              ) : (
                <TouchableOpacity className="py-3 rounded-xl border items-center" style={{ borderColor: colors.border }} onPress={() => setShowAddKey(true)} activeOpacity={0.8}>
                  <Text className="text-foreground font-semibold">{t('settings.addPersonalKey')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </SectionCard>
      )}

      <View className="mb-5">
        <Pressable onPress={handleAccountTitleTap} hitSlop={8}>
          <Text className="text-foreground/50 text-xs font-semibold uppercase tracking-widest mb-2 px-1">{t('settings.account')}</Text>
        </Pressable>
        <View className="h-px bg-border mb-4" />
        <View className="px-1">
          {userEmail && (
            <View className="mb-4">
              <Text className="text-foreground/50 text-xs font-semibold uppercase tracking-widest mb-1">{t('settings.loggedInAs')}</Text>
              <Text className="text-foreground text-sm">{userEmail}</Text>
            </View>
          )}
          <View className="mb-4">
            <ConfirmButton label={t('settings.logout')} confirmLabel={t('settings.logoutConfirm')} onConfirm={handleLogout} destructive />
          </View>
        </View>
      </View>
    </PageSheetModal>
  );
}
