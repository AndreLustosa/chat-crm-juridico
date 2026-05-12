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

// Pricing por 1M tokens (input/output).
// Atualizado 2026-05-12 com a lista oficial da OpenAI (developers.openai.com/pricing).
// Familias atuais (gen 5.4/5.5) + retrocompat com gen anterior (4.1/4o) e legados (o1/o3).
//
// IMPORTANTE: quando OpenAI publicar novos modelos, atualizar AQUI e em
// apps/web/src/app/atendimento/settings/ai/page.tsx (lista do dropdown).
export const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  // ─── Geracao 5.5 (flagship atual) ───
  'gpt-5.5':      { input: 5.00,  output: 30.00 },
  'gpt-5.5-pro':  { input: 30.00, output: 180.00 },
  // ─── Geracao 5.4 ───
  'gpt-5.4':      { input: 2.50,  output: 15.00 },
  'gpt-5.4-mini': { input: 0.75,  output: 4.50  },
  'gpt-5.4-nano': { input: 0.20,  output: 1.25  },
  'gpt-5.4-pro':  { input: 30.00, output: 180.00 },
  // ─── Geracao 4.x (compat) ───
  'gpt-4o':       { input: 5.00,  output: 15.00 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
  'gpt-4.1':      { input: 2.00,  output: 8.00  },
  'gpt-4.1-mini': { input: 0.40,  output: 1.60  },
  'gpt-4.1-nano': { input: 0.10,  output: 0.40  },
  // ─── Legados (o-series) ───
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
//
// Bug fix 2026-05-12 (Skills PR3 #M2):
// Regex anterior cobria gpt-5 (qualquer 5.x via prefixo), gpt-4.1, o1, o3.
// Confirmado pelo screenshot oficial OpenAI (developers.openai.com/pricing):
// gpt-5.4 e gpt-5.5 sao a familia atual e EXIGEM max_completion_tokens.
// A regex /^gpt-5/ ja cobre — mantemos por documentacao explicita.

function usesMaxCompletionTokens(model: string): boolean {
  if (!model) return false;
  return /^(gpt-5|gpt-4\.1|o1|o3)/i.test(model);
}

// ─── OpenAI Client ────────────────────────────────────────────

// Bug fix 2026-05-12 (Skills PR3 #M6+#M10):
// Singleton cache + timeout — espelha pattern do AnthropicClient abaixo.
const openaiClientCache = new Map<string, OpenAI>();
function getOpenAIClientLocal(apiKey: string): OpenAI {
  let c = openaiClientCache.get(apiKey);
  if (!c) {
    c = new OpenAI({
      apiKey,
      timeout: 60_000,
      maxRetries: 0,
    });
    openaiClientCache.set(apiKey, c);
  }
  return c;
}

export class OpenAIClient {
  private logger = new Logger('OpenAIClient');

  constructor(private apiKey: string) {}

  async chat(params: LLMChatParams): Promise<LLMResponse> {
    const client = getOpenAIClientLocal(this.apiKey);

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

// Bug fix 2026-05-12 (Skills PR3 #M6+#M10):
// Singleton cache do client Anthropic por apiKey + timeout explicito 60s.
// Antes: `new Anthropic()` a cada chamada — perde keepAlive, leak de sockets.
// Espelha o pattern de getOpenAIClient em memory-llm.util.ts.
const anthropicClientCache = new Map<string, Anthropic>();
function getAnthropicClient(apiKey: string): Anthropic {
  let c = anthropicClientCache.get(apiKey);
  if (!c) {
    c = new Anthropic({
      apiKey,
      timeout: 60_000, // 60s — match com OpenAI
      maxRetries: 0,   // desliga retry interno; deixa pro caller
    });
    anthropicClientCache.set(apiKey, c);
  }
  return c;
}

export class AnthropicClient {
  private logger = new Logger('AnthropicClient');

  constructor(private apiKey: string) {}

  async chat(params: LLMChatParams): Promise<LLMResponse> {
    const client = getAnthropicClient(this.apiKey);

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
      content: typeof m.content === 'string'
        ? m.content
        : this.convertToAnthropicContent(m.content),
    };
  }

  /**
   * Converte blocos de conteúdo multi-modal do formato OpenAI para Anthropic.
   * OpenAI: { type: 'image_url', image_url: { url: 'data:...' } }
   * Anthropic: { type: 'image', source: { type: 'base64', media_type, data } }
   */
  private convertToAnthropicContent(blocks: any[]): Anthropic.MessageParam['content'] {
    return blocks.map((block: any) => {
      if (block.type === 'image_url') {
        const url: string = block.image_url?.url || '';
        if (url.startsWith('data:')) {
          const commaIdx = url.indexOf(',');
          const header = url.slice(0, commaIdx); // 'data:image/jpeg;base64'
          const data = url.slice(commaIdx + 1);
          const mediaType = header.replace('data:', '').replace(';base64', '') as
            'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
          return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
        }
        // URL remota — usar image_url source (Anthropic Messages API)
        return { type: 'image', source: { type: 'url', url } };
      }
      if (block.type === 'text') return { type: 'text', text: block.text };
      return block;
    });
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
