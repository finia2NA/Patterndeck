import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useColors } from '@/constants/theme';
import { NeedsConfirmationButton } from '@/components/NeedsConfirmationButton';
import { useRouter } from 'expo-router';
import { clearAuthToken, clearUserEmail, clearUserId, getUserEmail } from '@/lib/storage';
import { deleteApiKey, getUsageStatus, hydrateSettings, parseEnabledLanguages, saveSettings } from '@/lib/api';
import type { UsageStatus } from '@/lib/api';
import { getSettingsSnapshot, resetLocalSettings } from '@/hooks/state/persistent/settingsStore';
import { PillDropdown } from '@/components/PillDropdown';
import { CARD_COUNTS, DEFAULT_LANGUAGES, formatCardCount } from '@/constants/session';
import type { CardCount } from '@/constants/session';
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

type CardOrder = 'sequential' | 'shuffled';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const ConfirmButton = NeedsConfirmationButton;

type KeyPreference = 'central' | 'own';
const DEFAULT_CARD_COUNT_OPTIONS = CARD_COUNTS.filter((count) => count !== 0);

export function SettingsModal({ visible, onClose }: SettingsModalProps) {
  const router = useRouter();
  const colors = useColors();
  const [cardOrder, setCardOrder] = useState<CardOrder>('shuffled');
  const [judgeWithExplanation, setJudgeWithExplanation] = useState<'on' | 'off'>('on');
  const [feedbackBrevity, setFeedbackBrevity] = useState<'brief' | 'normal'>('normal');
  const [defaultCardCount, setDefaultCardCount] = useState<CardCount>(10);
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

  useEffect(() => {
    if (!visible) return;
    let mounted = true;

    hydrateSettings().catch(() => {}).finally(() => {
      if (!mounted) return;
      const settings = getSettingsSnapshot();

      if (settings.card_order === 'sequential' || settings.card_order === 'shuffled') {
        setCardOrder(settings.card_order);
      }
      if (settings.judge_with_explanation === 'on' || settings.judge_with_explanation === 'off') {
        setJudgeWithExplanation(settings.judge_with_explanation);
      }
      if (settings.feedback_brevity === 'brief' || settings.feedback_brevity === 'normal') {
        setFeedbackBrevity(settings.feedback_brevity);
      }

      const n = settings.default_card_count ? parseInt(settings.default_card_count, 10) : 10;
      setDefaultCardCount(CARD_COUNTS.includes(n as CardCount) && n !== 0 ? n as CardCount : 10);
      setDailyDueTime(normalizeTime(settings.daily_due_time));
      setNotificationsEnabled(settings.notifications_enabled === 'on' ? 'on' : 'off');
      setNotificationTime(normalizeTime(settings.notification_time ?? '09:00'));
      setEnabledLanguages(parseEnabledLanguages(settings.enabled_languages ?? null, DEFAULT_LANGUAGES));
    });

    getUsageStatus().then(status => {
      if (mounted) setUsageStatus(status);
    }).catch(() => {});
    getUserEmail().then(email => {
      if (mounted) setUserEmail(email);
    }).catch(() => {});
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
      platformAlert('Notifications unavailable', message);
    } finally {
      setNotificationSetupBusy(false);
    }
  }

  async function handleDone() {
    const nextSettings = {
      ...getSettingsSnapshot(),
      card_order: cardOrder,
      judge_with_explanation: judgeWithExplanation,
      feedback_brevity: feedbackBrevity,
      default_card_count: String(defaultCardCount),
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
        await unregisterCurrentPushDevice().catch(() => {});
      }
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save settings.';
      platformAlert('Save failed', message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await unregisterCurrentPushDevice().catch(() => {});
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
    if (usageStatus) {
      setUsageStatus({ ...usageStatus, hasOwnKey: false });
    }
    if (!usageStatus?.centralKeyAvailable) {
      onClose();
      router.replace('/onboarding');
    }
  }

  function handleKeyAdded() {
    setShowAddKey(false);
    getUsageStatus().then(setUsageStatus).catch(() => {});
  }

  return (
    <PageSheetModal
      visible={visible}
      title="Settings"
      cancelText="Cancel"
      onCancel={onClose}
      confirmText={saving ? 'Saving…' : 'Done'}
      onConfirm={handleDone}
      confirmDisabled={saving}
      confirmCloses={false}
    >
      {/* Study Settings */}
      <SectionCard title="Study Settings">
        <SettingsRow
          label="Collection Card Order"
          description="Order of cards when studying a collection"
        >
          <PillDropdown
            value={cardOrder}
            options={['shuffled', 'sequential'] as const}
            onChange={setCardOrder}
            formatLabel={(v: CardOrder) => v === 'shuffled' ? 'Shuffled' : 'Sequential'}
          />
        </SettingsRow>
        <SettingsRow
          label="Context-Aware Judging"
          description="Pass the grammar explanation to the judging AI for more topic-relevant feedback. Uses API limits faster."
        >
          <PillDropdown
            value={judgeWithExplanation}
            options={['on', 'off'] as const}
            onChange={setJudgeWithExplanation}
            formatLabel={(v: 'on' | 'off') => v === 'on' ? 'On' : 'Off'}
          />
        </SettingsRow>
        <SettingsRow
          label="Feedback Brevity"
          description="Brief shows a few-word hint. Normal gives a fuller explanation."
        >
          <PillDropdown
            value={feedbackBrevity}
            options={['normal', 'brief'] as const}
            onChange={setFeedbackBrevity}
            formatLabel={(v: 'brief' | 'normal') => v === 'brief' ? 'Brief' : 'Normal'}
          />
        </SettingsRow>
        <SettingsRow
          label="Default Cards per Topic"
          description="How many cards to generate per deck by default"
        >
          <PillDropdown
            value={defaultCardCount}
            options={DEFAULT_CARD_COUNT_OPTIONS}
            onChange={setDefaultCardCount}
            formatLabel={formatCardCount}
          />
        </SettingsRow>
        <SettingsRow
          label="Daily Due Release Time"
          description="When decks become due each day"
        >
          <TimePicker value={dailyDueTime} onChange={(next: string) => setDailyDueTime(normalizeTime(next))} />
        </SettingsRow>
      </SectionCard>

      {/* Notifications */}
      <SectionCard title="Notifications">
        <SettingsRow
          label="Due Deck Reminders"
          description="Send a mobile reminder when decks are ready to review"
        >
          <Switch
            value={notificationsEnabled === 'on'}
            onValueChange={handleNotificationsToggle}
            disabled={saving || notificationSetupBusy}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </SettingsRow>
        <SettingsRow
          label="Reminder Time"
          description="When to notify you, separate from the due release time"
        >
          <TimePicker
            value={notificationTime}
            onChange={(next: string) => setNotificationTime(normalizeTime(next))}
            disabled={notificationsEnabled !== 'on'}
          />
        </SettingsRow>
      </SectionCard>

      {/* Languages */}
      <View className="mb-5">
        <Text className="text-foreground/50 text-xs font-semibold uppercase tracking-widest mb-2 px-1">
          Languages
        </Text>
        <View className="h-px bg-border mb-4" />
        <View className="px-1">
          <TouchTarget
            onPress={() => setLanguagesExpanded(e => !e)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 0 }}
          >
            <Text className="text-foreground text-sm font-medium">
              {languagesExpanded ? 'Hide Languages' : 'Show languages'}
            </Text>
            <Text className="text-foreground-secondary text-sm">{languagesExpanded ? '▼' : '▶'}</Text>
          </TouchTarget>
          <AnimatedCollapsible expanded={languagesExpanded} keepMounted={false}>
            <View className="pb-2">
              <Text className="text-foreground-secondary text-xs mb-4">
                Choose which languages appear in the language picker when creating decks.
              </Text>
              <LanguagePicker enabled={enabledLanguages} onChange={setEnabledLanguages} />
            </View>
          </AnimatedCollapsible>
        </View>
      </View>

      {/* API & Usage */}
      {usageStatus && (
        <SectionCard title="API & Usage">
          {usageStatus.centralKeyAvailable && (
            <Text className="text-foreground-secondary text-xs leading-5 mb-4">
              Some usage is included with your account using the server&apos;s API key.
              You can also connect your own Anthropic key if you&apos;d like unlimited usage.
            </Text>
          )}
          {usageStatus.centralKeyAvailable && (
            <SettingsRow
              label="Key Source"
              description="Which API key to use for AI requests"
            >
              <PillDropdown
                value={usageStatus.preference}
                options={['central', 'own'] as const}
                onChange={handleChangePreference}
                formatLabel={(v: KeyPreference) => v === 'central' ? 'Server Key' : 'My Own Key'}
              />
            </SettingsRow>
          )}
          {usageStatus.centralKeyAvailable && usageStatus.preference === 'central' && (
            <View className="mb-4">
              <Text className="text-foreground/60 text-xs font-medium mb-2 uppercase tracking-wide">This Month</Text>
              <UsageBar
                used={usageStatus.usage.central}
                limit={usageStatus.userLimit}
              />
              {usageStatus.globalLimitReached && (
                <Text className="text-xs mt-1" style={{ color: colors.error }}>
                  Global usage limit reached
                </Text>
              )}
            </View>
          )}
          {(!usageStatus.centralKeyAvailable || usageStatus.preference === 'own') && (
            <View className="mb-4">
              {usageStatus.hasOwnKey && (
                <View className="mb-3">
                  <Text className="text-foreground/60 text-xs font-medium mb-2 uppercase tracking-wide">This Month</Text>
                  <Text className="text-foreground-secondary text-xs">
                    Used: {formatCost(usageStatus.usage.own)}
                  </Text>
                </View>
              )}
              {usageStatus.hasOwnKey ? (
                <ConfirmButton
                  label="Delete Personal API Key"
                  confirmLabel="Tap again to delete key"
                  onConfirm={handleDeleteApiKey}
                  destructive
                />
              ) : showAddKey ? (
                <AddApiKeyForm onAdded={handleKeyAdded} />
              ) : (
                <TouchableOpacity
                  className="py-3 rounded-xl border items-center"
                  style={{ borderColor: colors.border }}
                  onPress={() => setShowAddKey(true)}
                  activeOpacity={0.8}
                >
                  <Text className="text-foreground font-semibold">Add Personal API Key</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </SectionCard>
      )}

      {/* Account */}
      <SectionCard title="Account">
        {userEmail && (
          <View className="mb-4">
            <Text className="text-foreground/50 text-xs font-semibold uppercase tracking-widest mb-1">Logged in as</Text>
            <Text className="text-foreground text-sm">{userEmail}</Text>
          </View>
        )}
        <View className="mb-4">
          <ConfirmButton
            label="Log Out"
            confirmLabel="Tap again to log out"
            onConfirm={handleLogout}
            destructive
          />
        </View>
      </SectionCard>
    </PageSheetModal>
  );
}
