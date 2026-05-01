import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { getAuthToken } from '@/lib/storage';
import {
  generateCards,
  getDeck,
  getNode,
  getDescendantDeckIds,
  getSetting,
  markStudied as apiMarkStudied,
} from '@/lib/api';
import type { Card, DeckCard, DeckData } from '@/lib/types';

interface UseMultiDeckSessionParams {
  nodeId: string;
  selectedDeckIds?: string[];
}

export interface DeckInfo {
  explanation: string;
  wasTruncated: boolean;
  topic: string;
  clarification: string | null;
  language: string;
  deckName: string;
  nodeId: string;
}

interface DeckMeta extends DeckData {
  id: string;
  deckName: string;
}

export function useMultiDeckSession({ nodeId, selectedDeckIds }: UseMultiDeckSessionParams) {
  const router = useRouter();
  const selectedDeckIdsKey = selectedDeckIds?.join(',') ?? '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [decks, setDecks] = useState<Map<string, DeckInfo>>(new Map());
  const [totalCost, setTotalCost] = useState(0);
  const [deckIds, setDeckIds] = useState<string[]>([]);

  const addCost = (usd: number) => setTotalCost(prev => prev + usd);

  const deckMetaRef = useRef<DeckMeta[]>([]);
  const generatedDecksRef = useRef<Set<string>>(new Set());
  const cardOrderRef = useRef<'shuffled' | 'sequential'>('shuffled');
  const generatingRef = useRef<Set<string>>(new Set());

  const generateForDeck = useCallback(async (meta: DeckMeta): Promise<DeckCard[]> => {
    if (generatedDecksRef.current.has(meta.id) || generatingRef.current.has(meta.id)) return [];
    generatingRef.current.add(meta.id);
    try {
      const result = await generateCards(meta.topic, meta.language, meta.cardCount, meta.explanation!);
      if (result.cost) addCost(result.cost);
      generatedDecksRef.current.add(meta.id);
      return result.cards.map((c): DeckCard => ({ ...c, deckId: meta.id }));
    } finally {
      generatingRef.current.delete(meta.id);
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const token = await getAuthToken();
        if (!token) { router.replace('/onboarding'); return; }

        const explicitIds = selectedDeckIdsKey
          ? selectedDeckIdsKey.split(',').map(s => s.trim()).filter(Boolean)
          : [];
        const ids = explicitIds.length > 0
          ? explicitIds
          : await getDescendantDeckIds(nodeId);
        if (ids.length === 0) {
          setLoadError('No decks found for this item.');
          setLoading(false);
          return;
        }
        setDeckIds(ids);

        const metaList: DeckMeta[] = [];
        const infoMap = new Map<string, DeckInfo>();

        for (const id of ids) {
          try {
            const d = await getDeck(id);
            if (!d || d.explanationStatus !== 'ready' || !d.explanation) continue;
            let deckName = d.topic;
            try {
              const node = await getNode(id);
              if (node) deckName = node.name;
            } catch {}
            metaList.push({ ...d, id, deckName });
            infoMap.set(id, {
              explanation: d.explanation!,
              wasTruncated: false,
              topic: d.topic,
              clarification: d.clarification,
              language: d.language,
              deckName,
              nodeId: id,
            });
          } catch { continue; }
        }

        if (metaList.length === 0) {
          setLoadError('No decks have finished generating their explanations yet.');
          setLoading(false);
          return;
        }

        setDecks(infoMap);

        const [cardOrder, defaultCountSetting] = await Promise.all([
          getSetting('card_order'),
          getSetting('default_card_count'),
        ]);
        cardOrderRef.current = (cardOrder ?? 'shuffled') as 'shuffled' | 'sequential';

        const defaultCardCount = defaultCountSetting ? parseInt(defaultCountSetting, 10) : 10;

        // Backfill zero cardCounts with the user's default before generating
        const resolvedMetaList = metaList.map(m => ({
          ...m,
          cardCount: m.cardCount > 0 ? m.cardCount : defaultCardCount,
        }));
        deckMetaRef.current = resolvedMetaList;

        if (cardOrder === 'sequential') {
          const initial = resolvedMetaList.slice(0, 2);
          const cardArrays = await Promise.all(initial.map(m => generateForDeck(m)));
          let allCards = cardArrays.flat();
          allCards = allCards.map((c, i) => ({ ...c, id: String(i) }));
          setCards(allCards);
        } else {
          const cardArrays = await Promise.all(resolvedMetaList.map(m => generateForDeck(m)));
          let allCards = cardArrays.flat();
          for (let i = allCards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allCards[i], allCards[j]] = [allCards[j], allCards[i]];
          }
          allCards = allCards.map((c, i) => ({ ...c, id: String(i) }));
          setCards(allCards);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Failed to generate session.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [nodeId, router, generateForDeck, selectedDeckIdsKey]);

  // In sequential mode, when the current deck's cards are exhausted,
  // pre-generate the next-not-yet-generated deck's cards.
  const prevFirstDeckId = useRef<string | null>(null);

  useEffect(() => {
    if (cardOrderRef.current !== 'sequential') return;
    if (cards.length === 0) return;

    const currentDeckId = cards[0].deckId;
    if (currentDeckId === prevFirstDeckId.current) return;
    prevFirstDeckId.current = currentDeckId;

    const metaList = deckMetaRef.current;
    const currentIdx = metaList.findIndex(m => m.id === currentDeckId);
    if (currentIdx === -1) return;

    const nextMeta = metaList[currentIdx + 1];
    if (!nextMeta) return;
    if (generatedDecksRef.current.has(nextMeta.id)) return;

    generateForDeck(nextMeta).then(newCards => {
      if (newCards.length === 0) return;
      setCards(prev => {
        const maxId = prev.reduce((max, c) => Math.max(max, parseInt(c.id)), 0);
        const indexed = newCards.map((c, i) => ({ ...c, id: String(maxId + 1 + i) }));
        return [...prev, ...indexed];
      });
    }).catch(err => {
      console.error('[session] Failed to pre-generate next deck cards:', err);
    });
  }, [cards, generateForDeck]);

  async function markStudied() {
    for (const id of deckIds) {
      await apiMarkStudied(id);
    }
  }

  return {
    loading,
    loadError,
    setLoadError,
    cards,
    setCards,
    decks,
    deckIds,
    totalCost,
    addCost,
    markStudied,
  };
}
