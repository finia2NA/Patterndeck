import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { getAuthToken } from '@/lib/storage';
import { generateExplanation, generateCards } from '@/lib/api';
import { getDisplayErrorMessage } from '@/lib/errorDisplay';
import type { AnalyticsContext, Card, LoadPhase } from '@/lib/types';
import { useI18n } from '@/lib/i18n';

interface UseSessionLoaderParams {
  topic: string;
  language: string;
  cardCount: number;
  existingExplanation?: string;
  analyticsContext?: AnalyticsContext;
}

export function useSessionLoader({ topic, language, cardCount, existingExplanation, analyticsContext }: UseSessionLoaderParams) {
  const router = useRouter();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>('explanation');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState(existingExplanation ?? '');
  const [explanationTruncated, setExplanationTruncated] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [totalCost, setTotalCost] = useState(0);

  const addCost = (usd: number) => setTotalCost(prev => prev + usd);

  useEffect(() => {
    let cancelled = false;
    const addCostIfCurrent = (usd: number) => {
      if (!cancelled) addCost(usd);
    };

    async function load() {
      try {
        const token = await getAuthToken();
        if (!token) { router.replace('/onboarding'); return; }

        let fullExplanation = existingExplanation ?? '';

        if (!existingExplanation) {
          const { wasTruncated } = await generateExplanation(
            topic, language,
            (chunk) => {
              if (cancelled) return;
              fullExplanation += chunk;
              setExplanation(prev => prev + chunk);
            },
            addCostIfCurrent,
            analyticsContext,
          );
          if (cancelled) return;
          setExplanationTruncated(wasTruncated);
        }

        if (cancelled) return;
        setLoadPhase('cards');
        const result = await generateCards(topic, language, cardCount, fullExplanation, analyticsContext);
        if (cancelled) return;
        if (result.cost) addCostIfCurrent(result.cost);
        setCards(result.cards);
      } catch (e) {
        if (cancelled) return;
        setLoadError(getDisplayErrorMessage(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [analyticsContext, cardCount, existingExplanation, language, router, t, topic]);

  return {
    loading,
    loadPhase,
    loadError,
    setLoadError,
    explanation,
    explanationTruncated,
    cards,
    setCards,
    totalCost,
    addCost,
  };
}
