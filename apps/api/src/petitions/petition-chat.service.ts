import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';

// ─── Constants ──────────────────────────────────────────────

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':  { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':   { input: 0.80,  output: 4.00  },
};

const BETA_HEADERS = [
  'code-execution-2025-08-25',
  'skills-2025-10-02',
  'files-api-2025-04-14',
];

// ─── Types ──────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | any[]; // string or content blocks array
}

export interface SkillRef {
  type: 'anthropic' | 'custom';
  skill_id: string;
  version?: string;
}

export interface StreamChatParams {
  messages: ChatMessage[];
  skills?: SkillRef[];
  model?: string;
  containerId?: string;      // Reuse container across turns
  systemPrompt?: string;     // Optional system prompt override
  fileIds?: string[];         // Files to attach via Files API
}

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class PetitionChatService {
  private readonly logger = new Logger(PetitionChatService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Public: Get Anthropic client ──────────────────────

  private async getClient(): Promise<Anthropic> {
    const storedKey = await this.settings.get('ANTHROPIC_API_KEY');
    const apiKey = storedKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Chave API da Anthropic não configurada. Configure em Ajustes > IA.');
    }
    return new Anthropic({ apiKey });
  }

  // ─── List skills from Claude Console ───────────────────

  async listConsoleSkills(source?: 'all' | 'anthropic' | 'custom') {
    const client = await this.getClient();

    try {
      const params: any = { betas: BETA_HEADERS };
      if (source) params.source = source;

      const result = await (client.beta as any).skills.list(params);

      return (result.data || []).map((s: any) => ({
        id: s.id,
        name: s.name || s.display_title || s.id,
        displayTitle: s.display_title || s.name || s.id,
        description: s.description || null,
        source: s.source,         // 'anthropic' | 'custom'
        createdAt: s.created_at,
      }));
    } catch (err: any) {
      this.logger.error('Erro ao listar skills do Console:', err?.message);
      // Fallback: return empty array instead of crashing
      return [];
    }
  }

  // ─── List files from Claude Console ────────────────────

  async listConsoleFiles() {
    const client = await this.getClient();

    try {
      const result = await (client.beta as any).files.list({
        betas: BETA_HEADERS,
      });

      return (result.data || []).map((f: any) => ({
        id: f.id,
        filename: f.filename,
        mimeType: f.mime_type,
        size: f.size_bytes,
        createdAt: f.created_at,
      }));
    } catch (err: any) {
      this.logger.error('Erro ao listar files do Console:', err?.message);
      return [];
    }
  }

  // ─── Upload file to Claude Console ─────────────────────

  async uploadFileToConsole(
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
  ) {
    const client = await this.getClient();

    try {
      const file = await (client.beta as any).files.upload(
        {
          file: new Blob([new Uint8Array(fileBuffer)], { type: mimeType }),
          purpose: 'user_upload',
        },
        { betas: BETA_HEADERS },
      );

      return {
        id: file.id,
        filename: file.filename || filename,
        mimeType: file.mime_type || mimeType,
        size: file.size_bytes,
      };
    } catch (err: any) {
      this.logger.error('Erro ao fazer upload para o Console:', err?.message);
      throw new Error(`Falha no upload: ${err?.message}`);
    }
  }

  // ─── Download file from Claude Console ─────────────────

  async downloadFileFromConsole(fileId: string): Promise<{
    buffer: Buffer;
    filename: string;
    contentType: string;
  }> {
    const client = await this.getClient();

    try {
      // Get metadata
      const metadata = await (client.beta as any).files.retrieve_metadata(
        fileId,
        { betas: BETA_HEADERS },
      );

      // Download content
      const content = await (client.beta as any).files.download(
        fileId,
        { betas: BETA_HEADERS },
      );

      // Convert to buffer
      let buffer: Buffer;
      if (content instanceof Buffer) {
        buffer = content;
      } else if (content.body) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of content.body) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
      } else if (typeof content.arrayBuffer === 'function') {
        buffer = Buffer.from(await content.arrayBuffer());
      } else {
        buffer = Buffer.from(content);
      }

      return {
        buffer,
        filename: metadata.filename || `file-${fileId}`,
        contentType: metadata.mime_type || 'application/octet-stream',
      };
    } catch (err: any) {
      this.logger.error('Erro ao baixar arquivo do Console:', err?.message);
      throw new Error(`Falha no download: ${err?.message}`);
    }
  }

  // ─── Stream chat with Claude Console skills ────────────

  async streamChat(params: StreamChatParams, res: Response): Promise<void> {
    let client: Anthropic;
    try {
      client = await this.getClient();
    } catch (err: any) {
      res.status(400).json({ message: err.message });
      return;
    }

    const model = params.model || 'claude-sonnet-4-6';

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // Build request params
      const requestParams: any = {
        model,
        max_tokens: 16384,
        messages: params.messages,
        betas: BETA_HEADERS,
      };

      // System prompt (optional override for free-form mode)
      if (params.systemPrompt) {
        requestParams.system = params.systemPrompt;
      }

      // Container with skills (Console integration)
      const hasSkills = params.skills && params.skills.length > 0;
      if (hasSkills || params.containerId) {
        const container: any = {};

        if (params.containerId) {
          container.id = params.containerId;
        }

        if (hasSkills) {
          container.skills = params.skills!.map((s) => ({
            type: s.type,
            skill_id: s.skill_id,
            version: s.version || 'latest',
          }));
        }

        requestParams.container = container;

        // Code execution tool is REQUIRED for skills
        requestParams.tools = [
          { type: 'code_execution_20250825', name: 'code_execution' },
        ];
      }

      // Attach file references in user messages if provided
      if (params.fileIds && params.fileIds.length > 0) {
        // Inject file references into the last user message
        const lastUserIdx = [...params.messages]
          .reverse()
          .findIndex((m) => m.role === 'user');
        if (lastUserIdx >= 0) {
          const idx = params.messages.length - 1 - lastUserIdx;
          const msg = params.messages[idx];
          const textContent = typeof msg.content === 'string' ? msg.content : '';

          // Build content blocks with file references
          const contentBlocks: any[] = params.fileIds.map((fid) => ({
            type: 'file',
            source: { type: 'file', file_id: fid },
          }));
          contentBlocks.push({ type: 'text', text: textContent });

          requestParams.messages = [...params.messages];
          requestParams.messages[idx] = {
            role: 'user',
            content: contentBlocks,
          };
        }
      }

      // Stream the response
      const stream = await (client.beta as any).messages.stream(requestParams);

      let containerId: string | null = null;
      const fileResults: any[] = [];

      for await (const event of stream) {
        // Text content
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta'
        ) {
          res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
        }

        // Message start — capture container ID and tokens
        if (event.type === 'message_start' && event.message) {
          if (event.message.container?.id) {
            containerId = event.message.container.id;
          }
          if (event.message.usage) {
            inputTokens = event.message.usage.input_tokens || 0;
          }
        }

        // Message delta — capture output tokens
        if (event.type === 'message_delta' && (event as any).usage) {
          outputTokens = (event as any).usage.output_tokens || 0;
        }

        // Code execution results — may contain file outputs
        if (
          event.type === 'content_block_stop' &&
          (event as any).content_block?.type === 'bash_code_execution_tool_result'
        ) {
          const block = (event as any).content_block;
          if (block.content?.content) {
            for (const item of block.content.content) {
              if (item.file_id) {
                fileResults.push({
                  fileId: item.file_id,
                  filename: item.filename || `file-${item.file_id}`,
                });
              }
            }
          }
        }
      }

      // Send metadata at the end (container ID for reuse, generated files)
      const metadata: any = { type: 'done' };
      if (containerId) metadata.containerId = containerId;
      if (fileResults.length > 0) metadata.files = fileResults;
      res.write(`data: ${JSON.stringify(metadata)}\n\n`);

      // Save usage
      this.saveUsage(model, inputTokens, outputTokens).catch((e) =>
        this.logger.error('Erro ao salvar usage:', e),
      );
    } catch (err: any) {
      this.logger.error('Anthropic stream error:', err?.message);
      res.write(
        `data: ${JSON.stringify({ type: 'error', message: err?.message || 'Erro ao conectar com a IA' })}\n\n`,
      );
    } finally {
      res.end();
    }
  }

  // ─── Private ──────────────────────────────────────────

  private async saveUsage(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    if (!inputTokens && !outputTokens) return;

    const priceEntry = Object.entries(ANTHROPIC_PRICING).find(([key]) =>
      model.startsWith(key),
    );
    const price = priceEntry ? priceEntry[1] : { input: 3.0, output: 15.0 };

    const costUsd =
      (inputTokens * price.input) / 1_000_000 +
      (outputTokens * price.output) / 1_000_000;

    try {
      await this.prisma.aiUsage.create({
        data: {
          conversation_id: null,
          skill_id: null,
          model,
          call_type: 'petition_chat',
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
          cost_usd: costUsd,
        },
      });
    } catch (e) {
      this.logger.error('Erro ao salvar aiUsage:', e);
    }
  }
}
