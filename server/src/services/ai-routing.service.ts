import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { config, isCentralKeyAvailable } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import type { PromptWithTool, ToolDef } from '../constants/prompts.js';
import { capture, captureAiGeneration, captureException, type AiAnalyticsContext } from './analytics.service.js';
import { decrypt } from './crypto.service.js';
import { getGlobalConfig, setGlobalConfig } from './global-config.service.js';
import { getSetting } from './settings.service.js';
import { canUseCentralKey, recordUsage } from './usage.service.js';
import { UI_LOCALE_LANGUAGE_NAMES, isUiLocale } from '@patterndeck/shared';

export const SONNET = 'claude-sonnet-4-6';
export const HAIKU = 'claude-haiku-4-5-20251001';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_VERSION = '2023-06-01';
const ROUTING_CONFIG_KEY = 'ai_routing_config';
const modelFetchStatus: Partial<Record<AiProvider, { ok: boolean; at: string; error?: string }>> = {};
const modelPriceCache: Partial<Record<string, { input: number; output: number }>> = {};

export const AI_PROVIDERS = ['anthropic', 'openai', 'openrouter', 'deepseek', 'mistral', 'kimi', 'qwen'] as const;
export type AiProvider = typeof AI_PROVIDERS[number];

export const AI_ENDPOINTS = [
  'cards',
  'judge',
  'rate-session',
  'explain-sentence',
  'word-hint',
  'explanation',
  'case-extraction',
  'rejection',
  'chat',
  'explanation-edit',
] as const;
export type AiEndpoint = typeof AI_ENDPOINTS[number];

export interface AiModelRef {
  provider: AiProvider;
  model: string;
}

export interface AiEndpointRoute {
  primary: AiModelRef;
  fallback?: AiModelRef | null;
}

export type AiRoutingConfig = Record<AiEndpoint, AiEndpointRoute>;

export interface ProviderModel {
  id: string;
  name?: string;
  contextLength?: number;
  inputPrice?: number;
  outputPrice?: number;
  supportsTools?: boolean;
  supportsStructuredOutputs?: boolean;
}

interface AiCallAnalytics {
  userId: string;
  endpoint: AiEndpoint;
  context?: AiAnalyticsContext;
}

interface Credentials {
  apiKey: string;
  source: 'central' | 'own';
  ownAnthropicOnly: boolean;
}

interface AttemptContext {
  analytics?: AiCallAnalytics;
  route: AiModelRef;
  credentials: Credentials;
  fallback?: boolean;
  fallbackFrom?: AiModelRef;
  stream: boolean;
  input?: unknown;
  output?: unknown;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cost?: number;
}

interface ProviderConfig {
  provider: AiProvider;
  label: string;
  apiKey: string | null;
  baseUrl: string;
  modelListSupport: 'live' | 'static';
  modelsPath?: string;
  curatedModels: ProviderModel[];
}

const PRICE: Record<string, { input: number; output: number }> = {
  [SONNET]: { input: 3.00, output: 15.00 },
  [HAIKU]: { input: 1.00, output: 5.00 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'gpt-5-nano': { input: 0.05, output: 0.40 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50 },
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },
  'deepseek/deepseek-v3.2': { input: 0.252, output: 0.378 },
  'mistral-small-2603': { input: 0.15, output: 0.60 },
  'mistral-large-2512': { input: 0.50, output: 1.50 },
  'kimi-k2.6': { input: 0.95, output: 4.00 },
  'qwen3-235b-a22b-instruct-2507': { input: 0.287, output: 0.92 },
};

export const AI_ENDPOINT_METADATA: Record<AiEndpoint, { label: string; description: string; mode: 'tool' | 'stream' | 'edit' }> = {
  cards: { label: 'Cards', description: 'Generate flashcards for a grammar topic.', mode: 'tool' },
  judge: { label: 'Judge Answer', description: 'Judge a learner translation attempt.', mode: 'tool' },
  'rate-session': { label: 'Rate Session', description: 'Rate and summarize a study session.', mode: 'tool' },
  'explain-sentence': { label: 'Explain Sentence', description: 'Explain a revealed card answer.', mode: 'tool' },
  'word-hint': { label: 'Word Hint', description: 'Generate dictionary-form vocabulary hints.', mode: 'tool' },
  explanation: { label: 'Explanation', description: 'Generate streamed grammar explanations.', mode: 'stream' },
  'case-extraction': { label: 'Case Extraction', description: 'Extract grammar coverage cases from explanations.', mode: 'tool' },
  rejection: { label: 'Rejection Review', description: 'Review a rejected learner answer.', mode: 'tool' },
  chat: { label: 'Card Chat', description: 'Stream tutor chat about the current card.', mode: 'stream' },
  'explanation-edit': { label: 'Explanation Edit', description: 'Apply tool-based edits to Markdown explanations.', mode: 'edit' },
};

export const DEFAULT_AI_ROUTING_CONFIG: AiRoutingConfig = Object.fromEntries(
  AI_ENDPOINTS.map(endpoint => {
    const model = ['cards', 'judge', 'rate-session', 'explain-sentence', 'word-hint'].includes(endpoint) ? HAIKU : SONNET;
    return [endpoint, { primary: { provider: 'anthropic', model }, fallback: null }];
  }),
) as AiRoutingConfig;

function providerConfigs(): Record<AiProvider, ProviderConfig> {
  return {
    anthropic: {
      provider: 'anthropic',
      label: 'Anthropic',
      apiKey: config.anthropicApiKey,
      baseUrl: 'https://api.anthropic.com/v1',
      modelListSupport: 'live',
      modelsPath: ANTHROPIC_MODELS_URL,
      curatedModels: [
        { id: SONNET, name: 'Claude Sonnet 4.6', inputPrice: 3, outputPrice: 15, supportsTools: true },
        { id: HAIKU, name: 'Claude Haiku 4.5', inputPrice: 1, outputPrice: 5, supportsTools: true },
      ],
    },
    openai: {
      provider: 'openai',
      label: 'OpenAI',
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      modelListSupport: 'live',
      curatedModels: [
        { id: 'gpt-5-mini', inputPrice: 0.25, outputPrice: 2, supportsTools: true, supportsStructuredOutputs: true },
        { id: 'gpt-5-nano', inputPrice: 0.05, outputPrice: 0.4, supportsTools: true, supportsStructuredOutputs: true },
      ],
    },
    openrouter: {
      provider: 'openrouter',
      label: 'OpenRouter',
      apiKey: config.openrouterApiKey,
      baseUrl: config.openrouterBaseUrl,
      modelListSupport: 'live',
      curatedModels: [
        { id: 'deepseek/deepseek-v3.2', inputPrice: 0.252, outputPrice: 0.378, supportsTools: true, supportsStructuredOutputs: true },
        { id: 'qwen/qwen3-235b-a22b-2507', inputPrice: 0.071, outputPrice: 0.1, supportsTools: true, supportsStructuredOutputs: true },
        { id: 'mistralai/mistral-small-2603', inputPrice: 0.15, outputPrice: 0.6, supportsTools: true, supportsStructuredOutputs: true },
      ],
    },
    deepseek: {
      provider: 'deepseek',
      label: 'DeepSeek',
      apiKey: config.deepseekApiKey,
      baseUrl: config.deepseekBaseUrl,
      modelListSupport: 'static',
      curatedModels: [
        { id: 'deepseek-v4-flash', inputPrice: 0.14, outputPrice: 0.28, supportsTools: true, supportsStructuredOutputs: true },
        { id: 'deepseek-v4-pro', inputPrice: 0.435, outputPrice: 0.87, supportsTools: true, supportsStructuredOutputs: true },
        { id: 'deepseek-chat', supportsTools: true, supportsStructuredOutputs: true },
      ],
    },
    mistral: {
      provider: 'mistral',
      label: 'Mistral',
      apiKey: config.mistralApiKey,
      baseUrl: config.mistralBaseUrl,
      modelListSupport: 'live',
      curatedModels: [
        { id: 'mistral-small-2603', inputPrice: 0.15, outputPrice: 0.6, supportsTools: true, supportsStructuredOutputs: true },
        { id: 'mistral-large-2512', inputPrice: 0.5, outputPrice: 1.5, supportsTools: true, supportsStructuredOutputs: true },
      ],
    },
    kimi: {
      provider: 'kimi',
      label: 'Kimi',
      apiKey: config.kimiApiKey,
      baseUrl: config.kimiBaseUrl,
      modelListSupport: 'live',
      curatedModels: [
        { id: 'kimi-k2.6', inputPrice: 0.95, outputPrice: 4, supportsTools: true, supportsStructuredOutputs: false },
        { id: 'kimi-k2.5', supportsTools: true, supportsStructuredOutputs: false },
      ],
    },
    qwen: {
      provider: 'qwen',
      label: 'Qwen',
      apiKey: config.qwenApiKey,
      baseUrl: config.qwenBaseUrl,
      modelListSupport: 'live',
      curatedModels: [
        { id: 'qwen3-235b-a22b-instruct-2507', inputPrice: 0.287, outputPrice: 0.92, supportsTools: true, supportsStructuredOutputs: true },
        { id: 'qwen-plus', supportsTools: true, supportsStructuredOutputs: true },
        { id: 'qwen-flash', supportsTools: true, supportsStructuredOutputs: true },
      ],
    },
  };
}

function priceKey(provider: AiProvider, model: string): string {
  return `${provider}:${model}`;
}

function cacheModelPrices(provider: AiProvider, models: ProviderModel[]) {
  for (const model of models) {
    if (model.inputPrice === undefined || model.outputPrice === undefined) continue;
    modelPriceCache[priceKey(provider, model.id)] = { input: model.inputPrice, output: model.outputPrice };
  }
}

function curatedPrice(provider: AiProvider, model: string): { input: number; output: number } | undefined {
  const listed = providerConfigs()[provider].curatedModels.find(item => item.id === model);
  if (listed?.inputPrice !== undefined && listed.outputPrice !== undefined) {
    return { input: listed.inputPrice, output: listed.outputPrice };
  }
  return undefined;
}

export function calcCost(model: string, inputTokens: number, outputTokens: number, provider?: AiProvider): number {
  const cached = provider ? modelPriceCache[priceKey(provider, model)] : undefined;
  const curated = provider ? curatedPrice(provider, model) : undefined;
  const direct = PRICE[model];
  const p = cached ?? curated ?? direct ?? { input: provider === 'anthropic' ? 3.00 : 0, output: provider === 'anthropic' ? 15.00 : 0 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error) return error.name;
  return undefined;
}

export function defaultTraceId(endpoint: string, context?: AiAnalyticsContext): string {
  if (context?.traceId) return context.traceId;
  if (context?.studySessionId && context.deckId) return `${endpoint}:${context.studySessionId}:${context.deckId}`;
  if (context?.studySessionId) return `${endpoint}:${context.studySessionId}`;
  if (context?.deckId) return `${endpoint}:${context.deckId}`;
  return `${endpoint}:${crypto.randomUUID()}`;
}

function isProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

function isEndpoint(value: unknown): value is AiEndpoint {
  return typeof value === 'string' && (AI_ENDPOINTS as readonly string[]).includes(value);
}

function cleanBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function anthropicHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

function bearerHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function providerHeaders(provider: AiProvider, apiKey: string) {
  if (provider === 'anthropic') return anthropicHeaders(apiKey);
  const headers = bearerHeaders(apiKey);
  if (provider === 'openrouter') {
    return {
      ...headers,
      'HTTP-Referer': config.appUrl,
      'X-Title': 'PatternDeck',
    };
  }
  return headers;
}

async function parseErrorResponse(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === 'string') return json.error;
    return json.error?.message ?? json.message ?? `HTTP ${res.status}`;
  } catch {
    return text.slice(0, 300);
  }
}

function shouldFallback(error: unknown): boolean {
  if (error instanceof AppError) {
    return !['USAGE_LIMIT', 'NO_API_KEY', 'MISSING_FIELDS', 'INVALID_CONFIG', 'INVALID_PROVIDER', 'INVALID_ENDPOINT'].includes(error.code);
  }
  if (error instanceof Error && error.name === 'AbortError') return false;
  return true;
}

async function resolveCredentials(userId: string): Promise<Credentials> {
  const preference = await getSetting(userId, 'api_key_preference');
  const centralAvailable = isCentralKeyAvailable();
  const effectivePref = preference ?? (centralAvailable ? 'central' : 'own');

  if (effectivePref === 'central' && centralAvailable) {
    const check = await canUseCentralKey(userId);
    if (!check.allowed) {
      throw new AppError(429, 'USAGE_LIMIT', check.reason ?? 'Usage limit reached. Please provide your own API key in settings to continue using AI features.');
    }
    return { apiKey: config.centralApiKey!, source: 'central', ownAnthropicOnly: false };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { claudeApiKey: true },
  });

  if (user?.claudeApiKey) {
    return { apiKey: decrypt(user.claudeApiKey), source: 'own', ownAnthropicOnly: true };
  }

  if (centralAvailable) {
    const check = await canUseCentralKey(userId);
    if (!check.allowed) throw new AppError(429, 'USAGE_LIMIT', check.reason ?? 'Usage limit reached.');
    return { apiKey: config.centralApiKey!, source: 'central', ownAnthropicOnly: false };
  }

  throw new AppError(400, 'NO_API_KEY', 'No API key available. Please add one in settings.');
}

function routeApiKey(route: AiModelRef, credentials: Credentials): string {
  if (route.provider === 'anthropic') return credentials.apiKey;
  const provider = providerConfigs()[route.provider];
  if (!provider.apiKey) throw new AppError(400, 'NO_API_KEY', `${provider.label} API key is not configured.`);
  return provider.apiKey;
}

export async function resolveApiKey(userId: string): Promise<{ apiKey: string; source: 'central' | 'own' }> {
  const credentials = await resolveCredentials(userId);
  return { apiKey: credentials.apiKey, source: credentials.source };
}

export async function resolveResponseLanguage(userId: string): Promise<string> {
  const locale = await getSetting(userId, 'ui_language');
  return locale !== null && isUiLocale(locale) ? UI_LOCALE_LANGUAGE_NAMES[locale] : 'English';
}

function normalizeRoute(endpoint: AiEndpoint, route: Partial<AiEndpointRoute> | undefined): AiEndpointRoute {
  const fallback = route?.fallback && isProvider(route.fallback.provider) && typeof route.fallback.model === 'string' && route.fallback.model.trim()
    ? { provider: route.fallback.provider, model: route.fallback.model.trim() }
    : null;
  const primary = route?.primary && isProvider(route.primary.provider) && typeof route.primary.model === 'string' && route.primary.model.trim()
    ? { provider: route.primary.provider, model: route.primary.model.trim() }
    : DEFAULT_AI_ROUTING_CONFIG[endpoint].primary;
  return { primary, fallback };
}

export async function getAiRoutingConfig(): Promise<AiRoutingConfig> {
  const raw = await getGlobalConfig(ROUTING_CONFIG_KEY);
  if (!raw) return DEFAULT_AI_ROUTING_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<AiEndpoint, Partial<AiEndpointRoute>>>;
    return Object.fromEntries(AI_ENDPOINTS.map(endpoint => [endpoint, normalizeRoute(endpoint, parsed[endpoint])])) as AiRoutingConfig;
  } catch {
    return DEFAULT_AI_ROUTING_CONFIG;
  }
}

export function validateAiRoutingConfig(input: unknown): AiRoutingConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'INVALID_CONFIG', 'AI routing config object is required.');
  }
  const configs = providerConfigs();
  const raw = input as Record<string, unknown>;
  const result: Partial<AiRoutingConfig> = {};
  for (const endpoint of AI_ENDPOINTS) {
    const value = raw[endpoint];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AppError(400, 'INVALID_CONFIG', `Missing route for ${endpoint}.`);
    }
    const route = value as { primary?: unknown; fallback?: unknown };
    const parseRef = (ref: unknown, label: string): AiModelRef => {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
        throw new AppError(400, 'INVALID_CONFIG', `${label} route for ${endpoint} is invalid.`);
      }
      const obj = ref as Record<string, unknown>;
      if (!isProvider(obj.provider)) throw new AppError(400, 'INVALID_PROVIDER', `Unknown provider for ${endpoint}.`);
      if (typeof obj.model !== 'string' || obj.model.trim().length === 0) {
        throw new AppError(400, 'INVALID_CONFIG', `Model is required for ${endpoint}.`);
      }
      if (!configs[obj.provider].apiKey) {
        throw new AppError(400, 'NO_API_KEY', `${configs[obj.provider].label} API key is not configured.`);
      }
      return { provider: obj.provider, model: obj.model.trim() };
    };
    const primary = parseRef(route.primary, 'Primary');
    let fallback: AiModelRef | null = null;
    if (route.fallback !== undefined && route.fallback !== null) fallback = parseRef(route.fallback, 'Fallback');
    result[endpoint] = { primary, fallback };
  }

  for (const key of Object.keys(raw)) {
    if (!isEndpoint(key)) throw new AppError(400, 'INVALID_ENDPOINT', `Unknown AI endpoint: ${key}.`);
  }
  return result as AiRoutingConfig;
}

export async function saveAiRoutingConfig(input: unknown): Promise<AiRoutingConfig> {
  const routing = validateAiRoutingConfig(input);
  await setGlobalConfig(ROUTING_CONFIG_KEY, JSON.stringify(routing));
  return routing;
}

export function getProviderAvailability() {
  return Object.values(providerConfigs()).map(provider => ({
    provider: provider.provider,
    label: provider.label,
    configured: !!provider.apiKey,
    baseUrl: provider.baseUrl,
    modelListSupport: provider.modelListSupport,
    lastModelFetchStatus: modelFetchStatus[provider.provider],
  }));
}

function normalizeOpenAiModels(provider: AiProvider, data: unknown): ProviderModel[] {
  const items = (data as { data?: unknown[] }).data;
  if (!Array.isArray(items)) throw new Error('Model list response did not include data array.');
  return items
    .map((item): ProviderModel | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : undefined;
      if (!id) return null;
      const pricing = obj.pricing && typeof obj.pricing === 'object' ? obj.pricing as Record<string, unknown> : {};
      const supported = Array.isArray(obj.supported_parameters) ? obj.supported_parameters.filter((v): v is string => typeof v === 'string') : [];
      return {
        id,
        name: typeof obj.name === 'string' ? obj.name : undefined,
        contextLength: typeof obj.context_length === 'number' ? obj.context_length : undefined,
        inputPrice: typeof pricing.prompt === 'string' ? Number(pricing.prompt) * 1_000_000 : undefined,
        outputPrice: typeof pricing.completion === 'string' ? Number(pricing.completion) * 1_000_000 : undefined,
        supportsTools: provider === 'openrouter' ? supported.includes('tools') : undefined,
        supportsStructuredOutputs: provider === 'openrouter' ? supported.includes('structured_outputs') || supported.includes('response_format') : undefined,
      } satisfies ProviderModel;
    })
    .filter((model): model is ProviderModel => model !== null);
}

function normalizeAnthropicModels(data: unknown): ProviderModel[] {
  const items = (data as { data?: unknown[] }).data;
  if (!Array.isArray(items)) throw new Error('Model list response did not include data array.');
  return items
    .map((item): ProviderModel | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : undefined;
      if (!id) return null;
      return { id, name: typeof obj.display_name === 'string' ? obj.display_name : id, supportsTools: true } satisfies ProviderModel;
    })
    .filter((model): model is ProviderModel => model !== null);
}

function normalizeMistralModels(data: unknown): ProviderModel[] {
  const items = (data as { data?: unknown[] }).data;
  if (!Array.isArray(items)) throw new Error('Model list response did not include data array.');
  return items
    .map((item): ProviderModel | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : undefined;
      if (!id) return null;
      return {
        id,
        name: typeof obj.name === 'string' ? obj.name : id,
        supportsTools: true,
        supportsStructuredOutputs: true,
      } satisfies ProviderModel;
    })
    .filter((model): model is ProviderModel => model !== null);
}

export async function fetchProviderModels(providerName: string) {
  if (!isProvider(providerName)) throw new AppError(400, 'INVALID_PROVIDER', 'Unknown AI provider.');
  const provider = providerConfigs()[providerName];
  if (!provider.apiKey) {
    modelFetchStatus[provider.provider] = { ok: false, at: new Date().toISOString(), error: 'Provider API key is not configured.' };
    cacheModelPrices(provider.provider, provider.curatedModels);
    return { provider: provider.provider, configured: false, modelListUnavailable: true, models: provider.curatedModels, error: 'Provider API key is not configured.' };
  }
  if (provider.modelListSupport === 'static') {
    modelFetchStatus[provider.provider] = { ok: false, at: new Date().toISOString(), error: 'Provider does not expose a reliable live model list.' };
    cacheModelPrices(provider.provider, provider.curatedModels);
    return { provider: provider.provider, configured: true, modelListUnavailable: true, models: provider.curatedModels, error: 'Provider does not expose a reliable live model list.' };
  }

  const url = provider.provider === 'anthropic'
    ? ANTHROPIC_MODELS_URL
    : `${cleanBaseUrl(provider.baseUrl)}/models`;

  try {
    const res = await fetch(url, { headers: providerHeaders(provider.provider, provider.apiKey) });
    if (!res.ok) throw new Error(await parseErrorResponse(res));
    const data = await res.json();
    const models = provider.provider === 'anthropic'
      ? normalizeAnthropicModels(data)
      : provider.provider === 'mistral'
        ? normalizeMistralModels(data)
        : normalizeOpenAiModels(provider.provider, data);
    cacheModelPrices(provider.provider, models);
    modelFetchStatus[provider.provider] = { ok: true, at: new Date().toISOString() };
    return { provider: provider.provider, configured: true, modelListUnavailable: false, models };
  } catch (error) {
    modelFetchStatus[provider.provider] = { ok: false, at: new Date().toISOString(), error: errorMessage(error) };
    cacheModelPrices(provider.provider, provider.curatedModels);
    return {
      provider: provider.provider,
      configured: true,
      modelListUnavailable: true,
      models: provider.curatedModels,
      error: errorMessage(error),
    };
  }
}

export async function getAiRoutingAdminPayload() {
  return {
    routing: await getAiRoutingConfig(),
    defaults: DEFAULT_AI_ROUTING_CONFIG,
    providers: getProviderAvailability(),
    endpoints: AI_ENDPOINT_METADATA,
  };
}

function candidateRoutes(endpoint: AiEndpoint, routing: AiRoutingConfig, credentials: Credentials): AiModelRef[] {
  const route = routing[endpoint];
  if (credentials.ownAnthropicOnly) {
    if (route.primary.provider === 'anthropic') return [route.primary];
    if (route.fallback?.provider === 'anthropic') return [route.fallback];
    return [DEFAULT_AI_ROUTING_CONFIG[endpoint].primary];
  }
  return [route.primary, route.fallback].filter((ref): ref is AiModelRef => !!ref);
}

function usageModelId(route: AiModelRef): string {
  return `${route.provider}:${route.model}`;
}

function captureAttempt(ctx: AttemptContext, usage: TokenUsage, cost: number, latencyMs: number, success: boolean, error?: unknown) {
  const analytics = ctx.analytics;
  if (!analytics) return;
  captureAiGeneration(analytics.userId, {
    ...analytics.context,
    endpoint: analytics.endpoint,
    traceId: defaultTraceId(analytics.endpoint, analytics.context),
    provider: ctx.route.provider,
    model: ctx.route.model,
    source: ctx.credentials.source,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost,
    latencyMs,
    success,
    errorCode: error ? errorCode(error) : undefined,
    errorMessage: error ? errorMessage(error) : undefined,
    stream: ctx.stream,
    fallback: ctx.fallback,
    fallbackFromProvider: ctx.fallbackFrom?.provider,
    fallbackFromModel: ctx.fallbackFrom?.model,
    input: ctx.input,
    output: ctx.output,
  });
}

function captureFailure(ctx: AttemptContext, usage: TokenUsage, latencyMs: number, error: unknown) {
  const analytics = ctx.analytics;
  if (!analytics) return;
  const cost = usage.cost ?? calcCost(ctx.route.model, usage.inputTokens, usage.outputTokens, ctx.route.provider);
  captureAttempt(ctx, usage, cost, latencyMs, false, error);
  captureException(error, analytics.userId, {
    endpoint: analytics.endpoint,
    provider: ctx.route.provider,
    model: ctx.route.model,
    study_session_id: analytics.context?.studySessionId,
    deck_id: analytics.context?.deckId,
  });
  capture(analytics.userId, 'ai_request_failed', {
    endpoint: analytics.endpoint,
    provider: ctx.route.provider,
    model: ctx.route.model,
    error_code: errorCode(error),
    study_session_id: analytics.context?.studySessionId,
    deck_id: analytics.context?.deckId,
  });
}

async function callAnthropicTool<T>(apiKey: string, model: string, prompt: PromptWithTool, userMessage: string, maxTokens: number): Promise<{ result: T; usage: TokenUsage }> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: prompt.system,
      tools: [{ name: prompt.tool.name, description: prompt.tool.description, input_schema: prompt.tool.inputSchema }],
      tool_choice: { type: 'tool', name: prompt.tool.name },
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(await parseErrorResponse(res));
  const data = await res.json() as { usage?: { input_tokens?: number; output_tokens?: number }; content?: { type: string; input?: unknown }[] };
  const toolUse = data.content?.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('No tool_use block in Anthropic response');
  return {
    result: toolUse.input as T,
    usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
  };
}

function openAiTools(tool: ToolDef) {
  return [{
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }];
}

async function callOpenAiTool<T>(route: AiModelRef, apiKey: string, prompt: PromptWithTool, userMessage: string, maxTokens: number): Promise<{ result: T; usage: TokenUsage }> {
  const provider = providerConfigs()[route.provider];
  const res = await fetch(`${cleanBaseUrl(provider.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: providerHeaders(route.provider, apiKey),
    body: JSON.stringify({
      model: route.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: userMessage },
      ],
      tools: openAiTools(prompt.tool),
      tool_choice: { type: 'function', function: { name: prompt.tool.name } },
    }),
  });
  if (!res.ok) throw new Error(await parseErrorResponse(res));
  const data = await res.json() as {
    usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string | object } }>; content?: string } }>;
  };
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (args === undefined) throw new Error('No tool call in provider response');
  const result = typeof args === 'string' ? JSON.parse(args) as T : args as T;
  return {
    result,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0,
      cost: typeof (data.usage as { cost?: unknown } | undefined)?.cost === 'number' ? (data.usage as { cost: number }).cost : undefined,
    },
  };
}

async function callRouteTool<T>(route: AiModelRef, credentials: Credentials, prompt: PromptWithTool, userMessage: string, maxTokens: number): Promise<{ result: T; usage: TokenUsage }> {
  const apiKey = routeApiKey(route, credentials);
  if (route.provider === 'anthropic') return callAnthropicTool<T>(apiKey, route.model, prompt, userMessage, maxTokens);
  return callOpenAiTool<T>(route, apiKey, prompt, userMessage, maxTokens);
}

export async function callStructuredTool<T>(
  userId: string,
  endpoint: AiEndpoint,
  prompt: PromptWithTool,
  userMessage: string,
  maxTokens: number,
  analytics?: AiCallAnalytics,
): Promise<{ result: T; cost: number; inputTokens: number; outputTokens: number; latencyMs: number; model: string; provider: AiProvider; source: 'central' | 'own' }> {
  const credentials = await resolveCredentials(userId);
  const routes = candidateRoutes(endpoint, await getAiRoutingConfig(), credentials);
  let firstError: unknown;
  const fallbackFrom = routes[0];

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const startedAt = Date.now();
    const ctx: AttemptContext = { analytics, route, credentials, stream: false, fallback: i > 0, fallbackFrom: i > 0 ? fallbackFrom : undefined, input: userMessage };
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      const response = await callRouteTool<T>(route, credentials, prompt, userMessage, maxTokens);
      usage = response.usage;
      const latencyMs = Date.now() - startedAt;
      const cost = usage.cost ?? calcCost(route.model, usage.inputTokens, usage.outputTokens, route.provider);
      captureAttempt({ ...ctx, output: response.result }, usage, cost, latencyMs, true);
      await recordUsage(userId, credentials.source, endpoint, usageModelId(route), cost);
      return { result: response.result, cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs, model: route.model, provider: route.provider, source: credentials.source };
    } catch (error) {
      captureFailure(ctx, usage, Date.now() - startedAt, error);
      firstError ??= error;
      if (i >= routes.length - 1 || !shouldFallback(error)) throw error;
    }
  }
  throw firstError;
}

async function callAnthropicTextStream(
  apiKey: string,
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  onChunk: (text: string) => void,
  signal: AbortSignal | undefined,
): Promise<{ usage: TokenUsage; wasTruncated: boolean }> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify({ model, max_tokens: maxTokens, system, stream: true, messages }),
    signal,
  });
  if (!res.ok) throw new Error(await parseErrorResponse(res));
  if (!res.body) throw new Error('Provider response did not include a stream body.');

  let buffer = '';
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let wasTruncated = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      const ev = JSON.parse(jsonStr);
      if (ev.type === 'message_start') usage.inputTokens = ev.message?.usage?.input_tokens ?? 0;
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') onChunk(ev.delta.text);
      if (ev.type === 'message_delta') {
        usage.outputTokens = ev.usage?.output_tokens ?? usage.outputTokens;
        if (ev.delta?.stop_reason === 'max_tokens') wasTruncated = true;
      }
    }
  }
  reader.cancel().catch(() => {});
  return { usage, wasTruncated };
}

function toOpenAiMessages(system: string, messages: Array<{ role: string; content: string }>) {
  return [
    { role: 'system', content: system },
    ...messages.map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    })),
  ];
}

async function callOpenAiTextStream(
  route: AiModelRef,
  apiKey: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  onChunk: (text: string) => void,
  signal: AbortSignal | undefined,
): Promise<{ usage: TokenUsage; wasTruncated: boolean }> {
  const provider = providerConfigs()[route.provider];
  const res = await fetch(`${cleanBaseUrl(provider.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: providerHeaders(route.provider, apiKey),
    body: JSON.stringify({
      model: route.model,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: toOpenAiMessages(system, messages),
    }),
    signal,
  });
  if (!res.ok) throw new Error(await parseErrorResponse(res));
  if (!res.body) throw new Error('Provider response did not include a stream body.');

  let buffer = '';
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let wasTruncated = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      const ev = JSON.parse(jsonStr);
      const delta = ev.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') onChunk(delta);
      const finishReason = ev.choices?.[0]?.finish_reason;
      if (finishReason === 'length') wasTruncated = true;
      if (ev.usage) {
        usage.inputTokens = ev.usage.prompt_tokens ?? ev.usage.input_tokens ?? usage.inputTokens;
        usage.outputTokens = ev.usage.completion_tokens ?? ev.usage.output_tokens ?? usage.outputTokens;
        usage.cost = typeof ev.usage.cost === 'number' ? ev.usage.cost : usage.cost;
      }
    }
  }
  reader.cancel().catch(() => {});
  return { usage, wasTruncated };
}

export async function callTextStream(
  userId: string,
  endpoint: Extract<AiEndpoint, 'explanation' | 'chat'>,
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  analytics?: AiCallAnalytics,
): Promise<{ wasTruncated: boolean; cost: number; inputTokens: number; outputTokens: number; latencyMs: number; model: string; provider: AiProvider; source: 'central' | 'own' }> {
  const credentials = await resolveCredentials(userId);
  const routes = candidateRoutes(endpoint, await getAiRoutingConfig(), credentials);
  let emitted = false;
  const fallbackFrom = routes[0];

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const startedAt = Date.now();
    const ctx: AttemptContext = { analytics, route, credentials, stream: true, fallback: i > 0, fallbackFrom: i > 0 ? fallbackFrom : undefined };
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      const apiKey = routeApiKey(route, credentials);
      const wrappedChunk = (text: string) => {
        emitted = true;
        onChunk(text);
      };
      const response = route.provider === 'anthropic'
        ? await callAnthropicTextStream(apiKey, route.model, system, messages, maxTokens, wrappedChunk, signal)
        : await callOpenAiTextStream(route, apiKey, system, messages, maxTokens, wrappedChunk, signal);
      usage = response.usage;
      const latencyMs = Date.now() - startedAt;
      const cost = usage.cost ?? calcCost(route.model, usage.inputTokens, usage.outputTokens, route.provider);
      captureAttempt(ctx, usage, cost, latencyMs, true);
      await recordUsage(userId, credentials.source, endpoint, usageModelId(route), cost);
      return { wasTruncated: response.wasTruncated, cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs, model: route.model, provider: route.provider, source: credentials.source };
    } catch (error) {
      captureFailure(ctx, usage, Date.now() - startedAt, error);
      if (i >= routes.length - 1 || emitted || !shouldFallback(error)) throw error;
    }
  }
  throw new Error('AI stream failed');
}

export async function callEditTools(
  userId: string,
  tools: ToolDef[],
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  analytics?: AiCallAnalytics,
): Promise<{ toolCalls: Array<{ name?: string; input?: Record<string, string> }>; text: string; cost: number; inputTokens: number; outputTokens: number; latencyMs: number; model: string; provider: AiProvider; source: 'central' | 'own' }> {
  const credentials = await resolveCredentials(userId);
  const routes = candidateRoutes('explanation-edit', await getAiRoutingConfig(), credentials);
  const fallbackFrom = routes[0];

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const startedAt = Date.now();
    const ctx: AttemptContext = { analytics, route, credentials, stream: false, fallback: i > 0, fallbackFrom: i > 0 ? fallbackFrom : undefined };
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      const apiKey = routeApiKey(route, credentials);
      let toolCalls: Array<{ name?: string; input?: Record<string, string> }> = [];
      let text = '';
      if (route.provider === 'anthropic') {
        const res = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: anthropicHeaders(apiKey),
          body: JSON.stringify({
            model: route.model,
            max_tokens: maxTokens,
            system,
            tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
            messages,
          }),
        });
        if (!res.ok) throw new Error(await parseErrorResponse(res));
        const data = await res.json() as { usage?: { input_tokens?: number; output_tokens?: number }; content?: Array<{ type: string; name?: string; input?: Record<string, string>; text?: string }> };
        usage = { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
        toolCalls = (data.content ?? []).filter(b => b.type === 'tool_use').map(b => ({ name: b.name, input: b.input }));
        text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
      } else {
        const res = await fetch(`${cleanBaseUrl(providerConfigs()[route.provider].baseUrl)}/chat/completions`, {
          method: 'POST',
          headers: providerHeaders(route.provider, apiKey),
          body: JSON.stringify({
            model: route.model,
            max_tokens: maxTokens,
            messages: toOpenAiMessages(system, messages),
            tools: tools.map(tool => openAiTools(tool)[0]),
            tool_choice: 'auto',
          }),
        });
        if (!res.ok) throw new Error(await parseErrorResponse(res));
        const data = await res.json() as { usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string | object } }> } }> };
        usage = { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, cost: data.usage?.cost };
        const message = data.choices?.[0]?.message;
        text = message?.content ?? '';
        toolCalls = (message?.tool_calls ?? []).map(call => {
          const args = call.function?.arguments;
          return { name: call.function?.name, input: typeof args === 'string' ? JSON.parse(args) as Record<string, string> : args as Record<string, string> | undefined };
        });
      }
      const latencyMs = Date.now() - startedAt;
      const cost = usage.cost ?? calcCost(route.model, usage.inputTokens, usage.outputTokens, route.provider);
      captureAttempt({ ...ctx, output: { tool_calls_count: toolCalls.length, summary_length: text.length } }, usage, cost, latencyMs, true);
      await recordUsage(userId, credentials.source, 'explanation-edit', usageModelId(route), cost);
      return { toolCalls, text, cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs, model: route.model, provider: route.provider, source: credentials.source };
    } catch (error) {
      captureFailure(ctx, usage, Date.now() - startedAt, error);
      if (i >= routes.length - 1 || !shouldFallback(error)) throw error;
    }
  }
  throw new Error('Explanation edit failed');
}

export { recordUsage };
