export interface Card {
  id: string;
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
  explanationSummary: string | null;
  explanationStatus: ExplanationStatus;
  grammarCaseStatus: GrammarCaseStatus;
  cardCount: number;
  lastStudiedAt: string | null;
  dueAt: number | null;
  isDue: boolean;
  intervalDays: number;
}

export interface TreeNode {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deck: DeckData | null;
  children: TreeNode[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
