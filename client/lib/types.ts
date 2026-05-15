export type LoadPhase = 'explanation' | 'cards' | 'fetching';
export type CardPhase = 'input' | 'judging' | 'correct' | 'wrong_explaining' | 'wrong_shown';
export const DID_NOT_KNOW_ANSWER = '(Did not know)';

export interface Card {
  id: string;
  // Legacy name: this is the translate-from/source sentence, localized to the UI language.
  english: string;
  targetLanguage: string;
  grammarCaseId?: string;
  grammarCaseKey?: string;
  grammarCaseLabel?: string;
  sentenceContext?: string;
  hint?: string;
}

export type ExplanationStatus = 'pending' | 'generating' | 'ready' | 'error';
export type GrammarCaseStatus = 'pending' | 'generating' | 'ready' | 'error';

export interface DeckData {
  nodeId: string;
  topic: string;
  clarification: string | null;
  language: string;
  explanation: string | null;
  explanationStatus: ExplanationStatus;
  grammarCaseStatus: GrammarCaseStatus;
  cardCount: number;
  lastStudiedAt: number | null;
  dueAt?: number | null;
  isDue?: boolean;
  intervalDays?: number;
}

export interface CardAttempt {
  card: Card;
  answers: string[];  // all attempts in order; last entry is always the correct one
  deckId?: string;
}

export interface TreeNode {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deck: DeckData | null;   // null = collection
  children: TreeNode[];    // populated by getTree()
}

export interface DeckCard extends Card {
  deckId: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  failed?: boolean;
}

export interface WordHint {
  infinitive: string;
  with_annotation: string;
  word_type: string;
}

export interface AnalyticsContext {
  appSessionId?: string;
  studySessionId?: string;
  deckId?: string;
  deckName?: string;
  deckTopic?: string;
  collectionPath?: string;
  language?: string;
  studyMode?: string;
  cardIndex?: number;
  attemptNumber?: number;
  turnIndex?: number;
  wordIndex?: number;
  traceId?: string;
}
