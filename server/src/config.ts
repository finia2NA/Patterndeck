import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const defaultAppUrl = process.env.NODE_ENV === 'production'
  ? 'https://patterndeck.richardhanss.de'
  : `http://localhost:${process.env.PORT ?? '3001'}`;

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: required('JWT_SECRET'),
  encryptionKey: required('ENCRYPTION_KEY'),
  appleClientId: process.env.APPLE_CLIENT_ID ?? '',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  openrouterApiKey: process.env.OPENROUTER_API_KEY || null,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || null,
  mistralApiKey: process.env.MISTRAL_API_KEY || null,
  kimiApiKey: process.env.KIMI_API_KEY || null,
  qwenApiKey: process.env.QWEN_API_KEY || null,
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  mistralBaseUrl: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
  kimiBaseUrl: process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1',
  qwenBaseUrl: process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  centralKeyGlobalMonthlyLimit: parseFloat(process.env.CENTRAL_KEY_GLOBAL_MONTHLY_LIMIT ?? '0'),
  resendApiKey: process.env.RESEND_API_KEY || null,
  appUrl: process.env.APP_URL || defaultAppUrl,
  emailFrom: process.env.EMAIL_FROM || 'PatternDeck <noreply@patterndeck.richardhanss.de>',
  posthogProjectApiKey: process.env.POSTHOG_PROJECT_API_KEY || null,
  posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  posthogEnabled: process.env.POSTHOG_ENABLED !== '0' && !!process.env.POSTHOG_PROJECT_API_KEY,
} as const;

export function isCentralKeyAvailable(): boolean {
  return config.anthropicApiKey != null;
}
