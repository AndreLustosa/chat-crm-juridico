import { Logger } from '@nestjs/common';
import type { OpenAIClient, AnthropicClient, LLMMessage, LLMToolDef, LLMToolCall, LLMResponse } from './llm-client';

export interface ToolContext {
  conversationId: string;
  leadId: string;
  leadPhone: string;
  instanceName: string | null;
  prisma: any;
  s3?: any;
  calendarService?: any;
  whatsappService?: any;
  skillAssets?: any[];
  reminderQueue?: any; // Bull queue for WhatsApp reminders (optional)
}

export interface ToolHandler {
  name: string;
  execute(params: Record<string, any>, context: ToolContext): Promise<any>;
}

export interface ToolCallLog {
  name: string;
  input: Record<string, any>;
  output: any;
  durationMs: number;
}

const MAX_ITERATIONS = 5;

/**
 * Tool Executor: implementa o loop de function calling.
 *
 * 1. Chama o LLM com tools
 * 2. Se resposta tem tool_calls → executa cada tool → adiciona resultados → chama novamente
 * 3. Repete até resposta sem tool_calls ou max iterações
 * 4. Retorna o texto final + logs das tool calls
 */
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);

  constructor(private handlers: Map<string, ToolHandler>) {}

  async execute(params: {
    client: OpenAIClient | AnthropicClient;
    model: string;
    systemPrompt: string;
    messages: LLMMessage[];
    tools: LLMToolDef[];
    maxTokens: number;
    temperature: number;
    context: ToolContext;
  }): Promise<{ response: LLMResponse; toolCallLogs: ToolCallLog[]; allMessages: LLMMessage[] }> {
    const { client, model, systemPrompt, tools, maxTokens, temperature, context } = params;
    const messages = [...params.messages];
    const toolCallLogs: ToolCallLog[] = [];
    let lastResponse: LLMResponse | null = null;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const response = await client.chat({
        model,
        systemPrompt,
        messages,
        tools,
        maxTokens,
        temperature,
      });

      lastResponse = response;

      // No tool calls → we're done
      if (!response.toolCalls.length) {
        return { response, toolCallLogs, allMessages: messages };
      }

      // Separa respond_to_client (ação terminal) dos demais tools
      const respondCall = response.toolCalls.find((tc) => tc.name === 'respond_to_client');
      const otherCalls = response.toolCalls.filter((tc) => tc.name !== 'respond_to_client');

      // Executa os outros tools normalmente (ex: update_lead) antes de encerrar
      if (otherCalls.length > 0) {
        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
        messages.push(assistantMsg);

        for (const toolCall of otherCalls) {
          const start = Date.now();
          let result: any;

          try {
            const handler = this.handlers.get(toolCall.name);
            if (!handler) {
              result = { error: `Tool "${toolCall.name}" não encontrada` };
              this.logger.warn(`[ToolExecutor] Handler não encontrado: ${toolCall.name}`);
            } else {
              const args = JSON.parse(toolCall.arguments);
              this.logger.log(`[ToolExecutor] Executando ${toolCall.name}(${JSON.stringify(args).slice(0, 200)})`);
              result = await handler.execute(args, context);
            }
          } catch (err: any) {
            result = { error: err.message || 'Erro ao executar tool' };
            this.logger.error(`[ToolExecutor] Erro em ${toolCall.name}: ${err.message}`);
          }

          const duration = Date.now() - start;
          toolCallLogs.push({
            name: toolCall.name,
            input: JSON.parse(toolCall.arguments),
            output: result,
            durationMs: duration,
          });

          messages.push({
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            tool_call_id: toolCall.id,
          });
        }
      }

      // Se respond_to_client foi chamado, loga e encerra o loop imediatamente
      if (respondCall) {
        toolCallLogs.push({
          name: respondCall.name,
          input: JSON.parse(respondCall.arguments),
          output: { success: true },
          durationMs: 0,
        });
        this.logger.log(`[ToolExecutor] respond_to_client chamado — encerrando loop`);
        return { response, toolCallLogs, allMessages: messages };
      }

      this.logger.log(`[ToolExecutor] Iteração ${iteration + 1}: ${otherCalls.length} tools executados`);
    }

    this.logger.warn(`[ToolExecutor] Atingiu max iterações (${MAX_ITERATIONS})`);
    return {
      response: lastResponse!,
      toolCallLogs,
      allMessages: messages,
    };
  }
}
