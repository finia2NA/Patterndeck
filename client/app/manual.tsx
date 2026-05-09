import { ScrollView, View, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogo } from '@/components/BrandLogo';
import { useI18n } from '@/lib/i18n';

interface SectionProps {
  title: string;
  body: string;
}

function ManualSection({ title, body }: SectionProps) {
  return (
    <View
      style={{
        marginBottom: 20,
        borderRadius: 16,
        padding: 20,
        ...(Platform.OS === 'web'
          ? { boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }
          : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 }),
      }}
      className="bg-surface border border-border"
    >
      <Text className="text-foreground font-bold text-base mb-2">{title}</Text>
      <Text className="text-foreground-secondary text-sm leading-6">{body}</Text>
    </View>
  );
}

export default function ManualPage() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 20,
          maxWidth: 680,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {/* Header */}
        <View style={{ marginBottom: 28, alignItems: 'flex-start' }}>
          <BrandLogo size={36} wordmarkSize={22} />
          <Text
            className="text-foreground font-bold"
            style={{ fontSize: 26, marginTop: 16, marginBottom: 8 }}
          >
            {t('manual.title')}
          </Text>
          <Text className="text-foreground-secondary text-sm leading-6">
            {t('manual.intro')}
          </Text>
        </View>

        {/* Divider */}
        <View className="border-b border-border" style={{ marginBottom: 20 }} />

        <ManualSection title={t('manual.quickStudy')} body={t('manual.quickStudyBody')} />
        <ManualSection title={t('manual.savedDecks')} body={t('manual.savedDecksBody')} />
        <ManualSection title={t('manual.deckButtons')} body={t('manual.deckButtonsBody')} />
        <ManualSection title={t('manual.studySessions')} body={t('manual.studySessionsBody')} />
        <ManualSection title={t('manual.enhancedEditor')} body={t('manual.enhancedEditorBody')} />
        <ManualSection title={t('manual.settings')} body={t('manual.settingsBody')} />
      </ScrollView>
    </View>
  );
}
