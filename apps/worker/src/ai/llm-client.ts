import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ─── Interfaces comuns ────────────────────────────────────────

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string; // JSON stringified
}

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface LLMToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface LLMChatParams {
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  tools?: LLMToolDef[];
  maxTokens: number;
  temperature: number;
  jsonMode?: boolean;
}

// ─── Pricing ──────────────────────────────────────────────────

export const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
  'gpt-4o':       { input: 5.00,  output: 15.00 },
  'gpt-4.1':      { input: 2.00,  output: 8.00  },
  'gpt-4.1-mini': { input: 0.40,  output: 1.60  },
  'gpt-4.1-nano': { input: 0.10,  output: 0.40  },
  'gpt-5':        { input: 15.00, output: 60.00 },
  'gpt-5-mini':   { input: 1.50,  output: 6.00  },
  'gpt-5.4-mini': { input: 1.00,  output: 4.00  },
  'o1':           { input: 15.00, output: 60.00 },
  'o3-mini':      { input: 1.10,  output: 4.40  },
};

export const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':   { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':  { input: 0.80,  output: 4.00  },
};

export function getPricing(model: string): { input: number; output: number } {
  // Try exact match first, then prefix match
  const allPricing = { ...OPENAI_PRICING, ...ANTHROPIC_PRICING };
  if (allPricing[model]) return allPricing[model];
  const prefix = Object.keys(allPricing).find((k) => model.startsWith(k));
  return prefix ? allPricing[prefix] : { input: 2.0, output: 8.0 };
}

export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = getPricing(model);
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}

// ─── Detectar modelos que usam max_completion_tokens ──────────

function usesMaxCompletionTokens(model: string): boolean {
  return /^(gpt-4\.1|gpt-5|o1|o3)/i.test(model);
}

// ─── OpenAI Client ────────────────────────────────────────────

export class OpenAIClient {
  private logger = new Logger('OpenAIClient');

  constructor(private apiKey: string) {}

  async chat(params: LLMChatParams): Promise<LLMResponse> {
    const client = new OpenAI({ apiKey: this.apiKey });

    // Build messages: system message first, then conversation
    const messages: any[] = [
      { role: 'system', content: params.systemPrompt },
      ...params.messages,
    ];

    const tokenParam = usesMaxCompletionTokens(params.model)
      ? { max_completion_tokens: params.maxTokens }
      : { max_tokens: params.maxTokens };

    const requestParams: any = {
      model: params.model,
      messages,
      ...tokenParam,
      temperature: params.temperature,
    };

    if (params.tools?.length) {
      requestParams.tools = params.tools;
      requestParams.tool_choice = 'auto';
    } else if (params.jsonMode) {
      requestParams.response_format = { type: 'json_object' };
    }

    const completion = await client.chat.completions.create(requestParams);
    const choice = completion.choices[0];
    const msg = choice?.message;

    const toolCalls: LLMToolCall[] = (msg?.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: msg?.content || null,
      toolCalls,
      finishReason: choice?.finish_reason || 'stop',
      usage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
      model: completion.model || params.model,
    };
  }
}

// ─── Anthropic Client ─────────────────────────────────────────

export class AnthropicClient {
  private logger = new Logger('AnthropicClient');

  constructor(private apiKey: string) {}

  async chat(params: LLMChatParams): Promise<LLMResponse> {
    const client = new Anthropic({ apiKey: this.apiKey });

    // Convert LLMMessage[] to Anthropic format (no system role in messages)
    const messages: Anthropic.MessageParam[] = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => this.convertMessage(m));

    // Convert tools to Anthropic format
    const tools: Anthropic.Tool[] | undefined = params.tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }));

    // Anthropic não tem response_format: json_object. Para forçar JSON:
    // Adicionar instrução no system prompt (prefill removido — modelos recentes não suportam)
    let systemPrompt = params.systemPrompt;
    const anthropicMessages = [...messages];
    if (params.jsonMode && !tools?.length) {
      systemPrompt += '\n\nIMPORTANTE: Retorne SOMENTE um JSON válido, sem texto antes ou depois. Comece com { e termine com }.';
    }

    const requestParams: Anthropic.MessageCreateParams = {
      model: params.model,
      system: systemPrompt,
      messages: anthropicMessages,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
    };

    if (tools?.length) {
      requestParams.tools = tools;
    }

    const response = await client.messages.create(requestParams);

    // Parse response content blocks
    let content: string | null = null;
    const toolCalls: LLMToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content = (content || '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content,
      toolCalls,
      finishReason: response.stop_reason || 'end_turn',
      usage: {
        promptTokens: response.usage?.input_tokens || 0,
        completionTokens: response.usage?.output_tokens || 0,
        totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      },
      model: response.model || params.model,
    };
  }

  private convertMessage(m: LLMMessage): Anthropic.MessageParam {
    if (m.role === 'tool') {
      // Anthropic uses tool_result content blocks inside user messages
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id || '',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }],
      };
    }

    if (m.role === 'assistant' && m.tool_calls?.length) {
      // Convert assistant tool_calls to Anthropic tool_use content blocks
      const content: any[] = [];
      if (m.content && typeof m.content === 'string') {
        content.push({ type: 'text', text: m.content });
      }
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || tc.name,
          input: typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.arguments || {},
        });
      }
      return { role: 'assistant', content };
    }

    return {
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic';

export function createLLMClient(provider: LLMProvider, apiKey: string): OpenAIClient | AnthropicClient {
  switch (provider) {
    case 'anthropic':
      return new AnthropicClient(apiKey);
    case 'openai':
    default:
      return new OpenAIClient(apiKey);
  }
}
