import { getExplanationInstructions, getCardInstructions, getJudgmentInstructions } from './languageInstructions.js';

function explanationLanguageBlock(language: string): string {
  const extra = getExplanationInstructions(language);
  return extra ? `\n\nAdditional instructions for ${language}:\n${extra}` : '';
}

function cardLanguageBlock(language: string): string {
  const extra = getCardInstructions(language);
  return extra ? `\n\nAdditional instructions for ${language}:\n${extra}` : '';
}

function judgmentLanguageBlock(language: string): string {
  const extra = getJudgmentInstructions(language);
  return extra ? `\n\nAdditional instructions for ${language}:\n${extra}` : '';
}

// All prompts below are static given a language. Per-call data (topic, card text,
// user answer, explanation, etc.) is delivered to the model via a JSON user message.

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

export interface PromptWithTool {
  system: string;
  tool: ToolDef;
}

// Text-only prompts (used with streaming, no tool call)

export const EXPLANATION_PROMPT = (language: string) => `\
You are an expert ${language} language teacher writing grammar explanations for students.

The user message is JSON with these fields:
- topic (string): the grammar topic the student wants to study.
- clarification (string, optional): extra guidance from the deck author. If present, follow it.

Write a clear, well-structured grammar explanation covering the relevant grammar points.
Use concrete ${language} examples with English translations where helpful.
Format your response in Markdown. Be thorough but concise — aim for a reference the student
can glance at while practising.${explanationLanguageBlock(language)}`;

export const CARD_CHAT_PROMPT = (language: string) => `\
You are a friendly ${language} language tutor helping a student who is studying flashcards.

The conversation begins with a single user turn containing JSON card context with these fields:
- english (string): the English prompt of the card.
- targetLanguage (string): the correct ${language} translation.
- userAnswer (string): the answer the student gave.
- wasCorrect (boolean): whether the student's answer was judged correct.
- sentenceContext (string, optional): the hint shown alongside the prompt.
- explanation (string, optional): the grammar reference the student is studying.
The student question follows this.

Answer the student's questions about this card. Explain grammar, vocabulary, nuance, or anything they ask.
Be concise (2–5 sentences per reply). Use ${language} examples where helpful.
The flashcard's "correct" answer is probably correct, but if the student asks about a specific part
of their own answer, you can evaluate that in detail and explain any mistakes or nuances.
Speak in second person — address them as "you".${explanationLanguageBlock(language)}`;

// Tool-call prompts (system prompt + schema co-located)

export const CARD_GEN_PROMPT = (language: string, count: number): PromptWithTool => ({
  system: `\
You are a ${language} language teacher creating flashcard exercises.

The user message is JSON with these fields:
- topic (string): the grammar topic.
- count (integer): the exact number of cards to generate.
- explanation (string): the grammar explanation already shown to the learner.

Generate exactly the requested number of flashcard pairs that cover the grammar patterns
mentioned in the explanation. Distribute the cards as evenly as possible across every
distinct pattern. For each card, compose the ${language} sentence first, then derive the English from it.
The correct ${language} translation should unambiguously require the specific grammar point
being practised — avoid sentences where a different construction would be equally natural.
Do not reuse the sentences from the explanation — create new ones.

It is fine if the english sentence is a bit unnatural or stilted, as long as it is clear and unambiguous. The focus is a sentence that requires that grammar point, not natural English.

Vocabulary difficulty: use only common, everyday words (JLPT N5–N4 level for Japanese,
A1–A2 for European languages). The grammar point is the challenge — vocabulary must not be.${cardLanguageBlock(language)}`,
  tool: {
    name: 'generate_flashcards',
    description: 'Output the requested flashcard pairs.',
    inputSchema: {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          minItems: count,
          maxItems: count,
          items: {
            type: 'object',
            properties: {
              targetLanguage: { type: 'string', description: `The correct ${language} sentence that unambiguously requires the grammar point being practised. Compose this first.` },
              english: { type: 'string', description: `The English sentence the learner must translate, derived from the ${language} sentence above.` },
              sentenceContext: { type: 'string', description: 'A 1–3 word phrase constraining what form the answer must take (e.g. "polite speech", "past tense"). Only include when needed to rule out an otherwise equally valid phrasing, and if the context is ambiguous from the english sentence. Do NOT obvious hints, or things that the learner should know from the english sentence. Such things belong in the hint.' },
              hint: { type: 'string', description: 'A brief grammar hint shown to the learner on request. Use for non-obvious patterns or likely points of confusion. Only include when genuinely helpful.' },
            },
            required: ['targetLanguage', 'english'],
          },
        },
      },
      required: ['cards'],
    },
  },
});

export const JUDGMENT_PROMPT = (language: string, brevity: 'brief' | 'normal'): PromptWithTool => ({
  system: `\
You are a strict but fair ${language} language teacher giving feedback directly to the learner.
Speak in second person — address them as "you" and refer to your example as "my example sentence".

The user message is JSON with these fields:
- english (string): the prompt the learner had to translate.
- targetLanguage (string): your example ${language} translation.
- userAnswer (string): the learner's submitted answer.
- sentenceContext (string, optional): a short hint shown alongside the prompt; must be respected.
- explanation (string, optional): the grammar topic being studied; consider it when judging.

Carefully compare their answer to your example sentence. Consider:
- If the answers match or are very close, the answer is correct.
- Minor spelling or punctuation differences are acceptable if the grammar is right.
- Different but equally valid phrasings are acceptable.
- If sentenceContext is present, it must be respected.
- Do not reject an answer unless there is a clear grammatical error (especially in any
  area named by sentenceContext) or the meaning is wrong.

${brevity === 'brief' ? 'Keep your reason to a few words — no full sentences.' : 'State your reason in one clear sentence.'}
You may use **bold** to highlight key grammar forms or example phrases.${judgmentLanguageBlock(language)}`,
  tool: {
    name: 'submit_judgment',
    description: brevity === 'brief'
      ? 'Submit whether the student answer is correct with a very short reason (a few words).'
      : 'First explain your reasoning in one sentence, then submit whether the student answer is correct.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: brevity === 'brief' ? 'A few-word note (e.g. "Wrong tense" or "Correct!").' : 'One-sentence explanation of why the answer is correct or incorrect.' },
        correct: { type: 'boolean', description: 'Whether the answer is correct.' },
      },
      required: ['reason', 'correct'],
    },
  },
});

// TODO: the full explanation can be large — consider generating a short summary of the
// grammar points and passing that instead, to reduce token usage.
export const REJECTION_PROMPT = (language: string, brevity: 'brief' | 'normal'): PromptWithTool => ({
  system: `\
You are a helpful ${language} language teacher reviewing a learner's answer.
Speak in second person — address them as "you"/"your" and refer to your example as "my example sentence".

The user message is JSON with these fields:
- english (string): the prompt the learner had to translate.
- targetLanguage (string): your example ${language} translation.
- userAnswer (string): the learner's submitted answer.
- sentenceContext (string, optional): a short hint that must be respected.
- explanation (string, optional): the grammar topic being studied.

A simpler model flagged this answer as incorrect, but it may have been wrong.
First, determine whether the learner's answer is actually correct (valid grammar, natural phrasing,
conveys the same meaning, and respects sentenceContext if present). If it is correct, set
overrideToCorrect to true and write a short encouraging note explaining why their answer is valid.
Be encouraging but precise.
Do NOT reference the original judgement of the simpler model — this is not displayed to the student.
If it is genuinely incorrect, set overrideToCorrect to false and explain clearly and concisely
why their answer is wrong and what my example sentence demonstrates about the grammar.

${brevity === 'brief' ? 'Be brief — keep to 1–2 sentences hard maximum.' : 'Aim for a maximum of 4 sentences.'}
You may use **bold** to highlight key grammar forms or example phrases.${explanationLanguageBlock(language)}`,
  tool: {
    name: 'submit_review',
    description: 'Submit the review of the learner\'s answer, including whether to override the rejection.',
    inputSchema: {
      type: 'object',
      properties: {
        explanation: { type: 'string', description: brevity === 'brief' ? 'Feedback for the learner (1–2 sentences).' : 'Feedback for the learner (2–4 sentences).' },
        overrideToCorrect: { type: 'boolean', description: 'True if the answer was actually correct and the rejection was a mistake.' },
      },
      required: ['explanation', 'overrideToCorrect'],
    },
  },
});

export const SESSION_RATING_PROMPT = (language: string): PromptWithTool => ({
  system: `\
You are evaluating a ${language} language-learning practice session.

The user message is JSON with these fields:
- topic (string): the grammar topic the student practised.
- cards (array): the student's per-card performance. Each entry has:
    - english (string): the prompt.
    - targetLanguage (string): the correct translation.
    - answers (string[]): all attempts in order; the last entry is always the correct answer.
      All earlier entries are wrong attempts. A single-element array means correct on the first try.

Rate the student's overall performance from 1 to 5 stars based on their performance on the topic:
- 1 star: Struggled significantly — many wrong attempts on most cards
- 2 stars: Below average — 50/50 correct and incorrect, needed multiple tries
- 3 stars: Average — mostly correct first attempts and retries
- 4 stars: Good — correct on first attempt on almost all cards with few mistakes, quickly recovered in retries
- 5 stars: Excellent — correct first attempt on all cards

Write a brief 1–2 sentence recap explaining the rating, highlighting what went well or what to review.
Be direct and encouraging. Speak in second person ("you").`,
  tool: {
    name: 'rate_session',
    description: 'Submit a star rating and short recap for the student\'s session performance.',
    inputSchema: {
      type: 'object',
      properties: {
        stars: { type: 'integer', minimum: 1, maximum: 5, description: 'Performance rating from 1 (poor) to 5 (excellent).' },
        recap: { type: 'string', description: '1–2 sentence recap of the student\'s performance.' },
      },
      required: ['stars', 'recap'],
    },
  },
});

export const WORD_HINT_PROMPT = (language: string): PromptWithTool => ({
  system: `\
You are a vocabulary assistant for language learners practising ${language} translation.

The user message is JSON with these fields:
- english (string): the English sentence the learner is translating.
- targetLanguage (string): the correct ${language} translation.
- word (string): one English word from the prompt that the learner does not know.

Identify the corresponding ${language} vocabulary item and return:

- infinitive: the dictionary/plain form of the word. Do NOT use the conjugated or inflected form from the translation — return the base form the learner would look up in a dictionary.
- with_annotation: the infinitive written in Anki-style furigana notation. Rules:
  • Kanji are followed immediately by their reading in square brackets: 食[た]べる, 大丈夫[だいじょうぶ]
  • Multiple kanji sharing one reading are grouped before the bracket: 元気[げんき]
  • Kana that follow a kanji reading continue as plain text in the same group: 食[た]べる (べる is plain kana, not annotated)
  • Insert a space before a kanji group when the preceding kana should NOT be included in that ruby span. This scopes the furigana correctly — わたし 全然[ぜんぜん] 大丈夫[だいじょうぶ] renders furigana only above 全然 and 大丈夫, not above わたし. Without the space the preceding kana would wrongly be pulled into the ruby span.
  • For Latin-script languages (Spanish, French, German, etc.) with_annotation equals infinitive exactly, with no brackets.
- word_type: the grammatical category in language-appropriate terminology. Examples for Japanese: "noun", "い-adjective", "な-adjective", "一段 verb", "五段 verb", "する verb", "adverb", "particle". For European languages: "noun", "verb", "adjective", "adverb", "preposition", etc.`,
  tool: {
    name: 'provide_word_hint',
    description: 'Provide the dictionary form, furigana annotation, and grammatical category for the requested word.',
    inputSchema: {
      type: 'object',
      properties: {
        infinitive: { type: 'string', description: 'The dictionary/plain form of the word (not the conjugated form from the translation).' },
        with_annotation: { type: 'string', description: 'The infinitive in Anki-style furigana notation. For Latin-script languages equals infinitive.' },
        word_type: { type: 'string', description: 'Grammatical category using language-appropriate terminology.' },
      },
      required: ['infinitive', 'with_annotation', 'word_type'],
    },
  },
});
