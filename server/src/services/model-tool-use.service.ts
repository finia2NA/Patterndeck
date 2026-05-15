import type { PromptWithTool, ToolDef } from '../constants/prompts.js';
import type { AiEndpoint, AiModelRef, AiProvider } from './ai-routing.service.js';

export type ToolCallMode = 'standard' | 'thinking-two-turn' | 'thinking-disabled';
export type ToolTaskKind = 'single' | 'multi-edit';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cost?: number;
}

type ToolCall = { name?: string; input?: Record<string, string> };
type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type ToolUseTask =
  | {
      kind: 'single';
      endpoint: AiEndpoint;
      prompt: PromptWithTool;
      userMessage: string;
      maxTokens: number;
      requiresThinking: boolean;
    }
  | {
      kind: 'multi-edit';
      endpoint: Extract<AiEndpoint, 'explanation-edit'>;
      tools: ToolDef[];
      system: string;
      messages: ChatMessage[];
      maxTokens: number;
      requiresThinking: boolean;
    };

export interface ToolUseRequestConfig {
  route: AiModelRef;
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  toolCallMode: ToolCallMode;
  parseErrorResponse: (res: Response) => Promise<string>;
}

export interface ToolUseResult<T> {
  result?: T;
  toolCalls?: ToolCall[];
  text: string;
  usage: TokenUsage;
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function cleanBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function openAiTool(tool: ToolDef) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toOpenAiMessages(system: string, messages: ChatMessage[]): OpenAiMessage[] {
  return [{ role: 'system', content: system }, ...messages];
}

function parseUsage(usage: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; cost?: number } | undefined): TokenUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
    cost: usage?.cost,
  };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cost: a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined,
  };
}

function parseToolArgs<T>(args: string | object | undefined): T {
  if (args === undefined) throw new Error('No tool call in provider response');
  return typeof args === 'string' ? JSON.parse(args) as T : args as T;
}

function effectiveToolCallMode(provider: AiProvider, configuredMode: ToolCallMode, task: ToolUseTask): ToolCallMode {
  if (provider !== 'deepseek') return 'standard';
  if (configuredMode === 'thinking-two-turn' && !task.requiresThinking) return 'thinking-disabled';
  return configuredMode;
}

function taskSystem(task: ToolUseTask): string {
  return task.kind === 'single' ? task.prompt.system : task.system;
}

function taskMessages(task: ToolUseTask): ChatMessage[] {
  return task.kind === 'single' ? [{ role: 'user', content: task.userMessage }] : task.messages;
}

function taskTools(task: ToolUseTask): ToolDef[] {
  return task.kind === 'single' ? [task.prompt.tool] : task.tools;
}

function deepSeekReasoningSystem(task: ToolUseTask): string {
  return `${taskSystem(task)}

Think through the task carefully and produce a concise final decision or content plan in plain text. Do not call tools in this turn.`;
}

function deepSeekFormattingSystem(task: ToolUseTask, reasoningText: string): string {
  const instruction = task.kind === 'single'
    ? 'Convert the prior decision into exactly one tool call matching the provided schema.'
    : 'Apply the prior edit plan using the available tools when exact edits are possible; otherwise return a concise text explanation.';
  return `${taskSystem(task)}

${instruction}

Prior reasoning summary:
${reasoningText.trim() || '(No summary returned.)'}`;
}

async function postJson(config: ToolUseRequestConfig, url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await config.parseErrorResponse(res));
  return res.json();
}

async function callAnthropicTool<T>(config: ToolUseRequestConfig, task: ToolUseTask): Promise<ToolUseResult<T>> {
  const body = task.kind === 'single'
    ? {
        model: config.route.model,
        max_tokens: task.maxTokens,
        system: task.prompt.system,
        tools: [{ name: task.prompt.tool.name, description: task.prompt.tool.description, input_schema: task.prompt.tool.inputSchema }],
        tool_choice: { type: 'tool', name: task.prompt.tool.name },
        messages: [{ role: 'user', content: task.userMessage }],
      }
    : {
        model: config.route.model,
        max_tokens: task.maxTokens,
        system: task.system,
        tools: task.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        messages: task.messages,
      };

  const data = await postJson(config, 'https://api.anthropic.com/v1/messages', body) as {
    usage?: { input_tokens?: number; output_tokens?: number };
    content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
  };
  const usage = { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };

  if (task.kind === 'single') {
    const toolUse = data.content?.find((b) => b.type === 'tool_use');
    if (!toolUse) throw new Error('No tool_use block in Anthropic response');
    return { result: toolUse.input as T, text: '', usage };
  }

  return {
    toolCalls: (data.content ?? [])
      .filter(b => b.type === 'tool_use')
      .map(b => ({ name: b.name, input: b.input as Record<string, string> | undefined })),
    text: (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim(),
    usage,
  };
}

async function callOpenAiCompatible<T>(
  config: ToolUseRequestConfig,
  task: ToolUseTask,
  options?: { thinking?: { type: 'enabled' | 'disabled' }; system?: string; messages?: ChatMessage[] },
): Promise<ToolUseResult<T>> {
  const system = options?.system ?? taskSystem(task);
  const messages = options?.messages ?? taskMessages(task);
  const body = {
    model: config.route.model,
    max_tokens: task.maxTokens,
    messages: toOpenAiMessages(system, messages),
    tools: taskTools(task).map(openAiTool),
    tool_choice: task.kind === 'single' ? 'required' : 'auto',
    ...(options?.thinking ? { thinking: options.thinking } : {}),
  };

  const data = await postJson(config, `${cleanBaseUrl(config.baseUrl)}/chat/completions`, body) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; cost?: number };
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string | object } }> } }>;
  };
  const message = data.choices?.[0]?.message;
  const usage = parseUsage(data.usage);

  if (task.kind === 'single') {
    const args = message?.tool_calls?.[0]?.function?.arguments;
    return { result: parseToolArgs<T>(args), text: message?.content ?? '', usage };
  }

  return {
    toolCalls: (message?.tool_calls ?? []).map(call => {
      const args = call.function?.arguments;
      return { name: call.function?.name, input: args === undefined ? undefined : parseToolArgs<Record<string, string>>(args) };
    }),
    text: message?.content ?? '',
    usage,
  };
}

async function callDeepSeekThinkingTwoTurn<T>(config: ToolUseRequestConfig, task: ToolUseTask): Promise<ToolUseResult<T>> {
  const reasoningBody = {
    model: config.route.model,
    max_tokens: task.maxTokens,
    messages: toOpenAiMessages(deepSeekReasoningSystem(task), taskMessages(task)),
    thinking: { type: 'enabled' },
  };
  const reasoningData = await postJson(config, `${cleanBaseUrl(config.baseUrl)}/chat/completions`, reasoningBody) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; cost?: number };
    choices?: Array<{ message?: { content?: string } }>;
  };
  const reasoningText = reasoningData.choices?.[0]?.message?.content ?? '';
  const reasoningUsage = parseUsage(reasoningData.usage);
  const formatting = await callOpenAiCompatible<T>(config, task, {
    thinking: { type: 'disabled' },
    system: deepSeekFormattingSystem(task, reasoningText),
    messages: taskMessages(task),
  });

  return {
    ...formatting,
    usage: addUsage(reasoningUsage, formatting.usage),
  };
}

export async function executeToolUse<T>(config: ToolUseRequestConfig, task: ToolUseTask): Promise<ToolUseResult<T>> {
  if (config.route.provider === 'anthropic') return callAnthropicTool<T>(config, task);

  const mode = effectiveToolCallMode(config.route.provider, config.toolCallMode, task);
  if (mode === 'thinking-two-turn') return callDeepSeekThinkingTwoTurn<T>(config, task);
  if (mode === 'thinking-disabled') {
    return callOpenAiCompatible<T>(config, task, { thinking: { type: 'disabled' } });
  }
  return callOpenAiCompatible<T>(config, task);
}
