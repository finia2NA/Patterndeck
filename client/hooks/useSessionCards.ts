import { useState, useEffect, useRef, useCallback } from 'react';
import { TextInput, Platform } from 'react-native';
import { judgeAnswer, explainRejection, explainSentence, chatAboutCard, getSetting, getUsageStatus } from '@/lib/api';
import { DID_NOT_KNOW_ANSWER, type AnalyticsContext, type Card, type CardPhase, type DeckCard, type ChatMessage, type CardAttempt, type WordHint } from '@/lib/types';
import { analytics } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

interface UseSessionCardsParams {
  cards: (Card | DeckCard)[];
  setCards: (fn: any) => void;
  language: string;
  explanation: string;
  addCost: (usd: number) => void;
  showErrorPopup: (error: unknown) => void;
  showOverlay: boolean;
  analyticsContext: AnalyticsContext;
  deckInfoById?: Map<string, { topic: string; deckName: string; language: string }>;
}

function toApiChatMessages(messages: ChatMessage[], nextUserMessage: ChatMessage) {
  const cleaned: ChatMessage[] = [];

  for (const message of messages) {
    if (message.failed) {
      if (cleaned[cleaned.length - 1]?.role === 'user') cleaned.pop();
      continue;
    }
    cleaned.push(message);
  }

  return [...cleaned, nextUserMessage].map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
}

export function useSessionCards({
  cards, setCards, language, explanation, addCost, showErrorPopup, showOverlay, analyticsContext, deckInfoById,
}: UseSessionCardsParams) {
  const { t } = useI18n();
  const [cardPhase, setCardPhase] = useState<CardPhase>('input');
  const [answer, setAnswer] = useState('');
  const [submittedAnswer, setSubmittedAnswer] = useState('');
  const [feedback, setFeedback] = useState('');
  const [wrongExplanation, setWrongExplanation] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [vocabHintDismissSignal, setVocabHintDismissSignal] = useState(0);
  const [judgeWithExplanation, setJudgeWithExplanation] = useState(true);
  const [feedbackBrevity, setFeedbackBrevity] = useState<'brief' | 'normal'>('normal');
  const [completedCards, setCompletedCards] = useState<CardAttempt[]>([]);
  const [wasSkipped, setWasSkipped] = useState(false);
  const [beginningTotalSpend, setBeginningTotalSpend] = useState<number | null>(null);
  const beginningSessionCostRef = useRef<number | null>(null);
  const cardWrongAnswers = useRef<Map<string, string[]>>(new Map());
  const hintCache = useRef<Map<string, WordHint>>(new Map());
  const chatCards = useRef<Set<string>>(new Set());
  const metricsRef = useRef({ chatCardsCount: 0, chatMessageCount: 0, hintCardsCount: 0, wordHintCount: 0 });
  const lastJudgmentRef = useRef<{ correct: boolean; overrideToCorrect: boolean; attemptNumber: number } | null>(null);
  const inputRef = useRef<TextInput>(null);

  const currentCardContext = useCallback((card: Card | DeckCard, attemptNumber?: number): AnalyticsContext => {
    const cardIndex = Number.isFinite(Number(card.id)) ? Number(card.id) : undefined;
    const deckId = (card as DeckCard).deckId;
    const deckInfo = deckId ? deckInfoById?.get(deckId) : undefined;
    return {
      ...analyticsContext,
      deckId: deckId ?? analyticsContext.deckId,
      deckName: deckInfo?.deckName ?? analyticsContext.deckName,
      deckTopic: deckInfo?.topic ?? analyticsContext.deckTopic,
      language: deckInfo?.language ?? analyticsContext.language,
      cardIndex,
      attemptNumber,
    };
  }, [analyticsContext, deckInfoById]);

  useEffect(() => {
    getSetting('judge_with_explanation').then(v => {
      if (v === 'off') setJudgeWithExplanation(false);
    });
    getSetting('feedback_brevity').then(v => {
      if (v === 'brief') setFeedbackBrevity('brief');
    });
    getUsageStatus().then(status => {
      const total = status.usage.central + status.usage.own;
      setBeginningTotalSpend(total);
      beginningSessionCostRef.current = total;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (cardPhase === 'input' && !showOverlay) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [cardPhase, showOverlay]);

  async function handleSubmitAnswer() {
    if (cardPhase !== 'input') return;
    const trimmed = answer.trim();
    const current = cards[0];

    // Empty answer = learner doesn't know; skip judging and just explain the sentence
    if (!trimmed) {
      setSubmittedAnswer('');
      setCardPhase('wrong_explaining');
      try {
        const result = await explainSentence(current, language, explanation, currentCardContext(current));
        if (result.cost) addCost(result.cost);
        setWasSkipped(true);
        setWrongExplanation(result.explanation);
        setCardPhase('wrong_shown');
      } catch (e) {
        analytics.captureException(e as Error, { action: 'explain_sentence' });
        showErrorPopup(e);
        setCardPhase('input');
      }
      return;
    }

    setWasSkipped(false);
    setSubmittedAnswer(trimmed);
    setCardPhase('judging');
    const prevWrongAnswers = cardWrongAnswers.current.get(current.id) ?? [];
    const attemptNumber = prevWrongAnswers.length + 1;
    const requestContext = currentCardContext(current, attemptNumber);

    try {
      const result = await judgeAnswer(current, trimmed, language, judgeWithExplanation ? explanation : undefined, feedbackBrevity, requestContext);
      if (result.cost) addCost(result.cost);

      if (result.correct) {
        lastJudgmentRef.current = { correct: true, overrideToCorrect: false, attemptNumber };
        setFeedback(result.reason);
        setCardPhase('correct');
      } else {
        setCardPhase('wrong_explaining');
        const rejection = await explainRejection(current, trimmed, language, explanation, feedbackBrevity, requestContext);
        if (rejection.cost) addCost(rejection.cost);
        if (rejection.overrideToCorrect) {
          lastJudgmentRef.current = { correct: true, overrideToCorrect: true, attemptNumber };
          setFeedback(rejection.explanation);
          setCardPhase('correct');
        } else {
          lastJudgmentRef.current = { correct: false, overrideToCorrect: false, attemptNumber };
          setWrongExplanation(rejection.explanation);
          setCardPhase('wrong_shown');
        }
      }
    } catch (e) {
      analytics.captureException(e as Error, { action: 'submit_answer' });
      showErrorPopup(e);
      setCardPhase('input');
    }
  }

  const handleConfirmCorrect = useCallback(() => {
    const current = cards[0];
    const prevAnswers = cardWrongAnswers.current.get(current.id) ?? [];
    const answers = [...prevAnswers, submittedAnswer];
    const judgment = lastJudgmentRef.current;
    analytics.track('card_answered', {
      ...currentCardContext(current, judgment?.attemptNumber ?? answers.length),
      was_correct_after_ai_judge: true,
      rejection_overridden_by_ai: judgment?.overrideToCorrect ?? false,
      attempt_number: judgment?.attemptNumber ?? answers.length,
      answer_length_bucket: submittedAnswer.length < 20 ? 'short' : submittedAnswer.length < 80 ? 'medium' : 'long',
      feedback_brevity: feedbackBrevity,
      judge_with_explanation: judgeWithExplanation,
    });
    cardWrongAnswers.current.delete(current.id);
    setCompletedCards(prev => [...prev, {
      card: current,
      answers,
      deckId: (current as DeckCard).deckId,
    }]);
    setCards((prev: any[]) => prev.slice(1));
    setAnswer('');
    setFeedback('');
    setShowHint(false);
    setChatMessages([]);
    setChatStreaming(false);
    setWasSkipped(false);
    lastJudgmentRef.current = null;
    setCardPhase('input');
  }, [cards, currentCardContext, feedbackBrevity, judgeWithExplanation, submittedAnswer, setCards]);

  const handleConfirmWrong = useCallback(() => {
    const current = cards[0];
    const prev = cardWrongAnswers.current.get(current.id) ?? [];
    const judgment = lastJudgmentRef.current;
    analytics.track('card_answered', {
      ...currentCardContext(current, judgment?.attemptNumber ?? prev.length + 1),
      was_correct_after_ai_judge: false,
      rejection_overridden_by_ai: false,
      skipped: wasSkipped,
      attempt_number: judgment?.attemptNumber ?? prev.length + 1,
      answer_length_bucket: wasSkipped ? 'skipped' : submittedAnswer.length < 20 ? 'short' : submittedAnswer.length < 80 ? 'medium' : 'long',
      feedback_brevity: feedbackBrevity,
      judge_with_explanation: judgeWithExplanation,
    });
    if (wasSkipped) {
      cardWrongAnswers.current.set(current.id, [...prev, DID_NOT_KNOW_ANSWER]);
    } else {
      cardWrongAnswers.current.set(current.id, [...prev, submittedAnswer]);
    }
    setCards((prev: any[]) => [...prev.slice(1), prev[0]]);
    setAnswer('');
    setWrongExplanation('');
    setShowHint(false);
    setChatMessages([]);
    setChatStreaming(false);
    setWasSkipped(false);
    lastJudgmentRef.current = null;
    setCardPhase('input');
  }, [cards, currentCardContext, feedbackBrevity, judgeWithExplanation, submittedAnswer, wasSkipped, setCards]);

  const handleOverrideWrong = useCallback(() => {
    const current = cards[0];
    const prevAnswers = cardWrongAnswers.current.get(current.id) ?? [];
    const answers = [...prevAnswers, submittedAnswer];
    const judgment = lastJudgmentRef.current;
    analytics.track('judgment_overridden', {
      ...currentCardContext(current, judgment?.attemptNumber ?? answers.length),
      user_sentence: submittedAnswer,
      generated_sentence: current.targetLanguage,
      attempt_number: judgment?.attemptNumber ?? answers.length,
      feedback_brevity: feedbackBrevity,
      judge_with_explanation: judgeWithExplanation,
    });
    analytics.track('card_answered', {
      ...currentCardContext(current, judgment?.attemptNumber ?? answers.length),
      was_correct_after_ai_judge: false,
      rejection_overridden_by_ai: false,
      rejection_overridden_by_user: true,
      attempt_number: judgment?.attemptNumber ?? answers.length,
      answer_length_bucket: submittedAnswer.length < 20 ? 'short' : submittedAnswer.length < 80 ? 'medium' : 'long',
      feedback_brevity: feedbackBrevity,
      judge_with_explanation: judgeWithExplanation,
    });
    cardWrongAnswers.current.delete(current.id);
    setCompletedCards(prev => [...prev, {
      card: current,
      answers,
      deckId: (current as DeckCard).deckId,
    }]);
    setCards((prev: any[]) => prev.slice(1));
    setAnswer('');
    setWrongExplanation('');
    setShowHint(false);
    setChatMessages([]);
    setChatStreaming(false);
    setWasSkipped(false);
    lastJudgmentRef.current = null;
    setCardPhase('input');
  }, [cards, currentCardContext, feedbackBrevity, judgeWithExplanation, submittedAnswer, setCards]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (cardPhase !== 'correct' && cardPhase !== 'wrong_shown') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        if (cardPhase === 'correct') handleConfirmCorrect();
        else handleConfirmWrong();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardPhase, handleConfirmCorrect, handleConfirmWrong]);

  async function handleChatSend(text: string) {
    const currentCard = cards[0];
    if (!currentCard || chatStreaming) return;
    const turnIndex = metricsRef.current.chatMessageCount + 1;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };

    setChatMessages(prev => [...prev, userMsg, assistantMsg]);
    setChatStreaming(true);
    if (!chatCards.current.has(currentCard.id)) {
      chatCards.current.add(currentCard.id);
      metricsRef.current.chatCardsCount += 1;
    }
    metricsRef.current.chatMessageCount += 1;

    const apiMessages = toApiChatMessages(chatMessages, userMsg);

    try {
      await chatAboutCard(
        currentCard, submittedAnswer, language,
        cardPhase === 'correct', apiMessages,
        (chunk) => {
          setChatMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, content: last.content + chunk };
            return updated;
          });
        },
        addCost, explanation,
        { ...currentCardContext(currentCard), turnIndex },
      );
    } catch (error) {
      analytics.captureException(error as Error, { action: 'chat_send' });
      setChatMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: t('session.chatError'),
          failed: true,
        };
        return updated;
      });
    } finally {
      setChatStreaming(false);
    }
  }

  return {
    cardPhase, answer, setAnswer, submittedAnswer,
    feedback, wrongExplanation, wasSkipped, showHint,
    chatMessages, chatStreaming, vocabHintDismissSignal, setVocabHintDismissSignal,
    completedCards, beginningTotalSpend, beginningSessionCostRef,
    hintCache, inputRef,
    metricsRef,
    handleSubmitAnswer, handleConfirmCorrect, handleConfirmWrong, handleOverrideWrong, handleChatSend,
    recordWordHint: () => { metricsRef.current.wordHintCount += 1; },
    toggleHint: () => {
      const current = cards[0];
      if (current) {
        metricsRef.current.hintCardsCount += showHint ? 0 : 1;
      }
      setShowHint(true);
    },
  };
}
