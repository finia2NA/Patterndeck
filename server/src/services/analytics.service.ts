import { PostHog } from 'posthog-node';
import { config } from '../config.js';

type AnalyticsProperties = Record<string, unknown>;

export interface AiAnalyticsContext {
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

interface AiGenerationEvent extends AiAnalyticsContext {
  endpoint: string;
  provider?: string;
  model: string;
  source?: 'central' | 'own';
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  latencyMs?: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  stream?: boolean;
  input?: unknown;
  output?: unknown;
}

const client = config.posthogEnabled && config.posthogProjectApiKey
  ? new PostHog(config.posthogProjectApiKey, {
      host: config.posthogHost,
      enableExceptionAutocapture: true,
    })
  : null;

function toSnakeProperties(properties: AnalyticsProperties = {}): AnalyticsProperties {
  const mapped: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined && value !== null) mapped[key] = value;
  }
  return mapped;
}

function contextProperties(context: AiAnalyticsContext = {}): AnalyticsProperties {
  return toSnakeProperties({
    study_session_id: context.studySessionId,
    app_session_id: context.appSessionId,
    $session_id: context.appSessionId,
    deck_id: context.deckId,
    deck_name: context.deckName,
    deck_topic: context.deckTopic,
    collection_path: context.collectionPath,
    language: context.language,
    study_mode: context.studyMode,
    card_index: context.cardIndex,
    attempt_number: context.attemptNumber,
    turn_index: context.turnIndex,
    word_index: context.wordIndex,
  });
}

export function isAnalyticsEnabled(): boolean {
  return client !== null;
}

export function capture(userId: string | undefined, event: string, properties: AnalyticsProperties = {}): void {
  if (!client || !userId) return;
  const appSessionId = typeof properties.app_session_id === 'string' ? properties.app_session_id : undefined;
  client.capture({
    distinctId: userId,
    event,
    properties: toSnakeProperties({
      ...properties,
      $session_id: appSessionId,
    }),
  });
}

export function identify(userId: string, properties: AnalyticsProperties = {}): void {
  if (!client) return;
  client.identify({
    distinctId: userId,
    properties: toSnakeProperties(properties),
  });
}

export function captureException(error: unknown, userId?: string, properties: AnalyticsProperties = {}): void {
  if (!client) return;
  client.captureException(error, userId, toSnakeProperties(properties));
}

export function captureAiGeneration(userId: string, event: AiGenerationEvent): void {
  if (!client) return;

  const totalTokens = (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
  client.capture({
    distinctId: userId,
    event: '$ai_generation',
    properties: toSnakeProperties({
      ...contextProperties(event),
      $ai_trace_id: event.traceId,
      $ai_session_id: event.studySessionId ?? event.appSessionId,
      $ai_provider: event.provider ?? 'anthropic',
      $ai_model: event.model,
      $ai_input_tokens: event.inputTokens,
      $ai_output_tokens: event.outputTokens,
      $ai_total_tokens: totalTokens || undefined,
      $ai_total_cost_usd: event.cost,
      $ai_latency: event.latencyMs !== undefined ? event.latencyMs / 1000 : undefined,
      endpoint: event.endpoint,
      api_key_source: event.source,
      success: event.success,
      error_code: event.errorCode,
      error_message: event.errorMessage,
      stream: event.stream,
      $ai_input: event.input,
      $ai_output: event.output,
    }),
  });
}

export async function flush(): Promise<void> {
  if (!client) return;
  await client.flush();
}

export async function shutdown(): Promise<void> {
  if (!client) return;
  await client._shutdown(3000);
}
