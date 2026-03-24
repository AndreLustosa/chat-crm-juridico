import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
  enableThinking?: boolean;  // Extended thinking (disabled by default to save rate limit)
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

  // ─── Raw fetch helper for Anthropic API ────────────────

  private async anthropicFetch(
    path: string,
    opts?: { method?: string; body?: any; headers?: Record<string, string> },
  ): Promise<any> {
    const apiKey = await this.getApiKey();
    const method = opts?.method || 'GET';

    const headers: Record<string, string> = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADERS.join(','),
      ...opts?.headers,
    };

    const fetchOpts: any = { method, headers };
    if (opts?.body) {
      if (typeof opts.body === 'string' || opts.body instanceof FormData) {
        fetchOpts.body = opts.body;
      } else {
        headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(opts.body);
      }
    }

    const res = await fetch(`https://api.anthropic.com${path}`, fetchOpts);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 300)}`);
    }

    return res.json();
  }

  private async getApiKey(): Promise<string> {
    const storedKey = await this.settings.get('ANTHROPIC_API_KEY');
    const apiKey = storedKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Chave API da Anthropic nao configurada. Configure em Ajustes > IA.',
      );
    }
    return apiKey;
  }

  // ─── List skills from Claude Console ───────────────────

  async listConsoleSkills(source?: 'all' | 'anthropic' | 'custom') {
    try {
      const query = source && source !== 'all' ? `?source=${source}` : '';
      const result = await this.anthropicFetch(`/v1/skills${query}`);

      return (result.data || []).map((s: any) => ({
        id: s.id,
        name: s.id,
        displayTitle: s.display_title || s.id,
        description: s.description || null,
        source: s.source,
        createdAt: s.created_at,
      }));
    } catch (err: any) {
      this.logger.error('Erro ao listar skills do Console:', err?.message);
      return [];
    }
  }

  // ─── Get a specific skill ────────────────────────────────

  async getConsoleSkill(skillId: string) {
    try {
      return await this.anthropicFetch(`/v1/skills/${skillId}`);
    } catch (err: any) {
      this.logger.error(`Erro ao buscar skill ${skillId}:`, err?.message);
      throw new Error(`Skill nao encontrada: ${err?.message}`);
    }
  }

  // ─── Create custom skill (via SKILL.md upload) ──────────

  async createCustomSkill(
    displayTitle: string,
    skillMdContent: string,
  ) {
    try {
      // The API expects multipart form data with SKILL.md file
      const formData = new FormData();
      formData.append('display_title', displayTitle);

      // Create a Blob for the SKILL.md file
      const skillBlob = new Blob([skillMdContent], { type: 'text/markdown' });
      formData.append('files', skillBlob, 'SKILL.md');

      const apiKey = await this.getApiKey();

      const res = await fetch('https://api.anthropic.com/v1/skills', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': BETA_HEADERS.join(','),
        },
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`${res.status}: ${errText.slice(0, 300)}`);
      }

      return res.json();
    } catch (err: any) {
      this.logger.error('Erro ao criar skill:', err?.message);
      throw new Error(`Falha ao criar skill: ${err?.message}`);
    }
  }

  // ─── Delete custom skill ─────────────────────────────────

  async deleteCustomSkill(skillId: string) {
    try {
      const apiKey = await this.getApiKey();

      const res = await fetch(`https://api.anthropic.com/v1/skills/${skillId}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': BETA_HEADERS.join(','),
        },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`${res.status}: ${errText.slice(0, 300)}`);
      }

      return { deleted: true };
    } catch (err: any) {
      this.logger.error(`Erro ao deletar skill ${skillId}:`, err?.message);
      throw new Error(`Falha ao deletar skill: ${err?.message}`);
    }
  }

  // ─── List files from Claude Console ────────────────────

  async listConsoleFiles() {
    try {
      const result = await this.anthropicFetch('/v1/files');

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
    try {
      const apiKey = await this.getApiKey();
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
      formData.append('file', blob, filename);

      const res = await fetch('https://api.anthropic.com/v1/files', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': BETA_HEADERS.join(','),
        },
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`${res.status}: ${errText.slice(0, 300)}`);
      }

      const file = await res.json();
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
    try {
      const apiKey = await this.getApiKey();

      // Get metadata
      const metaRes = await fetch(
        `https://api.anthropic.com/v1/files/${fileId}`,
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': BETA_HEADERS.join(','),
          },
        },
      );
      const metadata = metaRes.ok
        ? await metaRes.json()
        : { filename: `file-${fileId}`, mime_type: 'application/octet-stream' };

      // Download content
      const contentRes = await fetch(
        `https://api.anthropic.com/v1/files/${fileId}/content`,
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': BETA_HEADERS.join(','),
          },
        },
      );

      if (!contentRes.ok) {
        throw new Error(`Download failed: ${contentRes.status}`);
      }

      const buffer = Buffer.from(await contentRes.arrayBuffer());

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
      // ── Step 1: Sanitize messages ──────────────────────
      // Previous messages may contain complex content blocks (pdf, thinking, etc.)
      // Strip everything to plain text for safe replay.
      const sanitized = params.messages.map((m: any) => {
        if (typeof m.content === 'string') return { role: m.role, content: m.content };
        if (Array.isArray(m.content)) {
          const text = m.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text || '')
            .join('\n');
          return { role: m.role, content: text || '(arquivo anexado)' };
        }
        return { role: m.role, content: String(m.content || '') };
      });

      // ── Step 2: Truncate history to control tokens ─────
      const MAX_HISTORY = 20;
      const MAX_CHARS = 8000;
      let msgs = sanitized;

      if (sanitized.length > MAX_HISTORY) {
        msgs = [
          ...sanitized.slice(0, 2),
          { role: 'user' as const, content: '[... mensagens anteriores omitidas ...]' },
          ...sanitized.slice(-MAX_HISTORY + 3),
        ];
        this.logger.log(`Truncated ${sanitized.length} → ${msgs.length} messages`);
      }

      msgs = msgs.map((m) => ({
        ...m,
        content:
          typeof m.content === 'string' && m.content.length > MAX_CHARS
            ? m.content.slice(0, MAX_CHARS) + '\n[... truncado ...]'
            : m.content,
      }));

      // ── Step 3: Inject file references (container_upload) ──
      // Per Anthropic docs: files uploaded via Files API must use
      // { type: "container_upload", file_id: "..." } content blocks.
      const hasFiles = params.fileIds && params.fileIds.length > 0;
      if (hasFiles) {
        const lastUserIdx = msgs.length - 1 - [...msgs].reverse().findIndex((m) => m.role === 'user');
        if (lastUserIdx >= 0 && lastUserIdx < msgs.length) {
          const textContent = typeof msgs[lastUserIdx].content === 'string'
            ? msgs[lastUserIdx].content
            : '';

          const contentBlocks: any[] = params.fileIds!.map((fid) => ({
            type: 'container_upload',
            file_id: fid,
          }));
          contentBlocks.push({
            type: 'text',
            text: textContent || 'Analise o(s) arquivo(s) enviado(s) e responda de forma detalhada.',
          });

          msgs = [...msgs];
          msgs[lastUserIdx] = { role: 'user', content: contentBlocks };
        }
      }

      // ── Step 4: Pre-filter skills by relevance ──────────
      // The Anthropic Skills API claims "progressive disclosure" (metadata only
      // initially), but in practice ALL skill instructions are loaded, consuming
      // 6K+ tokens per skill. With 5 skills = 30K+ tokens → hits Tier 1 limit.
      // Solution: only send skills that match the user's message keywords.

      const SKILL_KEYWORDS: Record<string, string[]> = {
        xlsx: ['planilha', 'excel', 'spreadsheet', 'xlsx', 'tabela', 'calcul', 'dados'],
        pptx: ['apresentacao', 'slide', 'powerpoint', 'pptx', 'deck'],
        docx: ['word', 'documento', 'docx', 'relatorio', 'contrato', 'oficio', 'minuta'],
        pdf: ['pdf', 'gerar pdf', 'converter pdf', 'extrair pdf'],
      };

      // Keywords from custom skill IDs (derived from skill ID name)
      // Used to match user message to custom skills without loading full content
      const CUSTOM_SKILL_KEYWORDS: Record<string, string[]> = {
        'analise-audiencia-criminal': ['criminal', 'audiencia', 'pena', 'denuncia', 'acusado', 'reu', 'crime', 'delito', 'processo criminal', 'defesa criminal', 'habeas corpus'],
        'peticoes-criminais': ['criminal', 'peticao criminal', 'habeas corpus', 'apelacao criminal', 'recurso criminal', 'defesa penal'],
        'replica-contestacao-trabalhista': ['replica', 'trabalhista', 'trabalhis', 'clt', 'reclamacao', 'reclamante', 'empregad', 'horas extras', 'rescisao', 'fgts', 'verbas'],
        'alegacoes-finais-civeis': ['alegacoes finais', 'memoriais', 'consumidor', 'cdc', 'dano moral'],
        'analise-trct': ['trct', 'rescisao', 'verbas rescisórias', 'demissão'],
        'calculos-trabalhistas': ['calculo', 'calculos trabalhistas', 'liquidacao', 'horas extras calcul'],
        'notificacao-extrajudicial': ['notificacao', 'notific', 'interpelacao', 'cobranca extrajudicial'],
        'recurso-inominado': ['recurso inominado', 'juizado', 'turma recursal'],
        'usucapiao': ['usucapiao', 'posse', 'prescricao aquisitiva'],
        'inventario': ['inventario', 'heranca', 'espolio', 'inventariante', 'partilha'],
        'quesitos-pericia': ['quesitos', 'pericia', 'perito', 'laudo'],
        'recursos-stj': ['stj', 'recurso especial', 'embargos de declaracao'],
        'revisao-peticoes': ['revisar', 'revisao', 'corrigir peticao', 'conferir peticao'],
        'analise-caso': ['analise de caso', 'viabilidade', 'parecer', 'teses'],
      };

      let filteredSkills = params.skills || [];

      if (filteredSkills.length > 0) {
        const lastUserMsg = [...msgs].reverse().find((m) => m.role === 'user');
        const rawText = typeof lastUserMsg?.content === 'string'
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg?.content || '');
        const userText = rawText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Trivial/meta messages — skip ALL skills (greetings, questions about skills, short messages)
        const isTrivial =
          userText.length < 15 ||
          /^(oi|ola|bom dia|boa tarde|boa noite|hey|hi|hello|obrigad|valeu|ok|tudo bem|como vai)\b/.test(userText) ||
          /\b(vc tem|voce tem|tem skill|tem capacidade|quais skills|o que voce|pode me ajudar|me ajuda com)\b/.test(userText);

        if (isTrivial) {
          this.logger.log('Trivial/meta message — skipping all skills');
          filteredSkills = [];
        } else if (!hasFiles) {
          const matched = filteredSkills.filter((s) => {
            if (s.type === 'custom') {
              // Match custom skills via their keyword map (derived from skill ID)
              const skillName = s.skill_id.toLowerCase().replace(/skill_[a-z0-9]+$/i, '');
              // Find matching entry by checking if any key is contained in skill_id
              const entry = Object.entries(CUSTOM_SKILL_KEYWORDS).find(([key]) =>
                s.skill_id.toLowerCase().includes(key) || key.split('-').every(w => s.skill_id.toLowerCase().includes(w.slice(0, 4)))
              );
              const keywords = entry ? entry[1] : [];
              return keywords.length > 0
                ? keywords.some((kw) => userText.includes(kw))
                : false; // unknown custom skill: don't send without explicit match
            }
            // Anthropic built-in skills: check keyword map
            const keywords = SKILL_KEYWORDS[s.skill_id] || [];
            return keywords.some((kw) => userText.includes(kw));
          });

          filteredSkills = matched;
          if (matched.length > 0) {
            this.logger.log(`Skills matched: ${matched.map((s) => s.skill_id).join(', ')}`);
          } else {
            this.logger.log('No skill keyword match — sending 0 skills');
          }
        }
      }

      const hasSkills = filteredSkills.length > 0;
      const needsBeta = hasSkills || !!params.containerId || hasFiles;

      // ── Step 5: Build request body ─────────────────────
      // max_tokens é contado no rate limit de tokens/min (reservado).
      // Reduzir de 16384 → 4096 poupa ~12K tokens do budget de rate limit.
      // thinking budget também é reservado: desativado por padrão.
      const wantsThinking = params.enableThinking === true;

      const buildBody = (opts?: { noSkills?: boolean; noThinking?: boolean }): { body: any; useBeta: boolean } => {
        // max_tokens adaptive: menor para conversas simples, maior quando precisar gerar documentos
        const actualHasSkillsForBody = (hasSkills && !opts?.noSkills) || hasFiles;
        const adaptiveMaxTokens = actualHasSkillsForBody ? 8192 : 2048;

        const b: any = {
          model,
          max_tokens: adaptiveMaxTokens,
          messages: msgs,
        };

        // Thinking: apenas se explicitamente solicitado e sem arquivos
        if (wantsThinking && !opts?.noThinking && !hasFiles) {
          b.thinking = { type: 'enabled', budget_tokens: 2000 };
          b.max_tokens = adaptiveMaxTokens + 2000;
        }

        if (params.systemPrompt) b.system = params.systemPrompt;

        // Only use beta path when there are ACTUAL skills, a containerId, or files.
        // Never send an empty container — it forces beta mode for no reason.
        const actualHasSkills = hasSkills && !opts?.noSkills;
        const useBeta = (actualHasSkills || !!params.containerId || hasFiles);

        if (useBeta) {
          const container: any = {};
          if (params.containerId) container.id = params.containerId;
          if (actualHasSkills) {
            container.skills = filteredSkills.map((s) => ({
              type: s.type,
              skill_id: s.skill_id,
              version: s.version || 'latest',
            }));
          }
          // Only attach container if it has content
          if (Object.keys(container).length > 0) {
            b.container = container;
          }
          b.tools = [
            { type: 'code_execution_20250825', name: 'code_execution' },
          ];
        }

        return { body: b, useBeta: !!useBeta };
      };

      // ── Step 6: Stream helper (reusable for retry) ─────

      let resultContainerId: string | null = null;
      const fileResults: any[] = [];

      const doStream = async (reqBody: any, _useBeta: boolean) => {
        const apiKey = await this.getApiKey();
        reqBody.stream = true;

        // CRITICAL: Only include beta headers when actually needed.
        // interleaved-thinking causes Anthropic to auto-reserve tokens
        // even without the thinking param — DON'T include it unless thinking is on.
        const betaList: string[] = [];
        if (reqBody.thinking) {
          betaList.push('interleaved-thinking-2025-05-14');
        }
        if (_useBeta) {
          betaList.push('code-execution-2025-08-25', 'skills-2025-10-02', 'files-api-2025-04-14');
        }

        const reqHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        };
        // Only add beta header when there are actual betas to include
        if (betaList.length > 0) {
          reqHeaders['anthropic-beta'] = betaList.join(',');
        }

        const bodyJson = JSON.stringify(reqBody);
        const msgsTokenEst = Math.ceil(
          reqBody.messages.reduce((a: number, m: any) => {
            const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return a + c.length;
          }, 0) / 4,
        );
        const systemTokenEst = Math.ceil((reqBody.system?.length || 0) / 4);

        this.logger.log(
          `Sending request: model=${reqBody.model} max_tokens=${reqBody.max_tokens} ` +
          `thinking=${!!reqBody.thinking} beta=[${betaList.join(',')}] ` +
          `skills=${reqBody.container?.skills?.length ?? 0} container=${!!reqBody.container?.id} ` +
          `body_bytes=${bodyJson.length} msgs=${reqBody.messages.length} ` +
          `est_tokens(system=${systemTokenEst} msgs=${msgsTokenEst} total=${systemTokenEst + msgsTokenEst})`,
        );

        const fetchRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: reqHeaders,
          body: bodyJson,
        });

        if (!fetchRes.ok) {
          const errBody = await fetchRes.text();
          this.logger.error(`Anthropic API error ${fetchRes.status}: ${errBody.slice(0, 500)}`);

          if (fetchRes.status === 429) {
            const err = new Error('RATE_LIMIT') as any;
            err.statusCode = 429;
            throw err;
          }
          throw new Error(`Erro da API Anthropic (${fetchRes.status}): ${errBody.slice(0, 300)}`);
        }

        const reader = fetchRes.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;

            try {
              const event = JSON.parse(payload);

              if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
                res.write(`data: ${JSON.stringify({ type: 'thinking', text: event.delta.thinking })}\n\n`);
              }
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
              }
              if (event.type === 'message_start' && event.message) {
                if (event.message.container?.id) resultContainerId = event.message.container.id;
                if (event.message.usage) inputTokens = event.message.usage.input_tokens || 0;
              }
              if (event.type === 'message_delta' && event.usage) {
                outputTokens = event.usage.output_tokens || 0;
              }

              if (
                event.type === 'content_block_stop' &&
                event.content_block?.type === 'bash_code_execution_tool_result'
              ) {
                const items = event.content_block.content?.content || [];
                for (const item of items) {
                  if (item.file_id) {
                    fileResults.push({
                      fileId: item.file_id,
                      filename: item.filename || `file-${item.file_id}`,
                    });
                  }
                }
              }
            } catch {
              // Skip malformed SSE chunks
            }
          }
        }
      };

      // ── Step 7: Execute with retry logic ───────────────
      // If rate limit hit, retry without skills (reduce token count)

      const { body: firstBody, useBeta: firstUseBeta } = buildBody();

      // Estimate tokens (rough: 1 token ≈ 4 chars for text messages)
      const textCharCount = msgs.reduce((acc, m) => {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return acc + c.length;
      }, 0) + (params.systemPrompt?.length || 0);
      const estimatedTokens = Math.ceil(textCharCount / 4);
      this.logger.log(`Estimated input: ~${estimatedTokens} text tokens + files/skills overhead`);

      try {
        await doStream(firstBody, firstUseBeta);
      } catch (err: any) {
        if (err?.message === 'RATE_LIMIT' && hasSkills) {
          // Retry without skills to reduce token count
          this.logger.warn('Rate limit hit — retrying without skills...');
          res.write(`data: ${JSON.stringify({ type: 'info', text: '⚠️ Limite de tokens excedido. Retentando sem skills...' })}\n\n`);

          const { body: retryBody, useBeta: retryBeta } = buildBody({ noSkills: true, noThinking: true });
          try {
            await doStream(retryBody, retryBeta);
          } catch (retryErr: any) {
            if (retryErr?.message === 'RATE_LIMIT') {
              throw new Error(
                'Limite de tokens excedido mesmo sem skills. Seu plano permite apenas 30.000 tokens/min. ' +
                'Aguarde 1 minuto ou use o modelo Haiku (mais leve). Para processar PDFs grandes, ' +
                'solicite aumento de limite em console.anthropic.com.',
              );
            }
            throw retryErr;
          }
        } else if (err?.message === 'RATE_LIMIT') {
          throw new Error(
            'Limite de 30.000 tokens/min excedido. Seu plano Anthropic e Tier 1. ' +
            'Opcoes: (1) Aguarde 1 minuto, (2) Use modelo Haiku, (3) Solicite aumento em console.anthropic.com',
          );
        } else {
          throw err;
        }
      }

      // ── Step 8: Send done metadata ─────────────────────
      const metadata: any = { type: 'done' };
      if (resultContainerId) metadata.containerId = resultContainerId;
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

  // ─── Chat CRUD (PostgreSQL persistence) ───────────────

  /** List all chats for a user, ordered by last update */
  async listChats(userId: string, tenantId: string) {
    return this.prisma.aiChat.findMany({
      where: { user_id: userId, tenant_id: tenantId },
      orderBy: { updated_at: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        model: true,
        container_id: true,
        updated_at: true,
        created_at: true,
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { content: true, role: true },
        },
      },
    });
  }

  /** Get a single chat with all messages */
  async getChat(chatId: string, userId: string) {
    return this.prisma.aiChat.findFirst({
      where: { id: chatId, user_id: userId },
      include: {
        messages: { orderBy: { created_at: 'asc' } },
      },
    });
  }

  /** Create a new chat */
  async createChat(userId: string, tenantId: string, model: string) {
    return this.prisma.aiChat.create({
      data: {
        user_id: userId,
        tenant_id: tenantId,
        model,
        title: 'Nova Conversa',
      },
    });
  }

  /** Update chat metadata (title, model, container_id) */
  async updateChat(
    chatId: string,
    userId: string,
    data: { title?: string; model?: string; container_id?: string | null },
  ) {
    return this.prisma.aiChat.updateMany({
      where: { id: chatId, user_id: userId },
      data,
    });
  }

  /** Add a message to a chat */
  async addMessage(
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
    filesJson?: any,
  ) {
    // Update the chat's updated_at timestamp
    await this.prisma.aiChat.update({
      where: { id: chatId },
      data: { updated_at: new Date() },
    });

    const msg = await this.prisma.aiChatMessage.create({
      data: {
        chat_id: chatId,
        role,
        content,
        files_json: filesJson || undefined,
      },
    });

    // Auto-title on first user message
    if (role === 'user') {
      const chat = await this.prisma.aiChat.findUnique({ where: { id: chatId } });
      if (chat && chat.title === 'Nova Conversa') {
        const title = content.slice(0, 60) + (content.length > 60 ? '...' : '');
        await this.prisma.aiChat.update({
          where: { id: chatId },
          data: { title },
        });
      }
    }

    return msg;
  }

  /** Auto-generate title from first user message */
  async autoTitle(chatId: string, userId: string) {
    const chat = await this.prisma.aiChat.findFirst({
      where: { id: chatId, user_id: userId },
      include: {
        messages: {
          where: { role: 'user' },
          orderBy: { created_at: 'asc' },
          take: 1,
        },
      },
    });
    if (!chat || chat.title !== 'Nova Conversa') return;

    const firstMsg = chat.messages[0];
    if (!firstMsg) return;

    const title =
      firstMsg.content.slice(0, 60) +
      (firstMsg.content.length > 60 ? '...' : '');

    await this.prisma.aiChat.update({
      where: { id: chatId },
      data: { title },
    });
  }

  /** Delete a chat */
  async deleteChat(chatId: string, userId: string) {
    return this.prisma.aiChat.deleteMany({
      where: { id: chatId, user_id: userId },
    });
  }

  /** Cleanup: delete chats not updated in 6 months — runs daily at 3:17 AM */
  @Cron('17 3 * * *')
  async cleanupOldChats(): Promise<number> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const result = await this.prisma.aiChat.deleteMany({
      where: { updated_at: { lt: sixMonthsAgo } },
    });

    if (result.count > 0) {
      this.logger.log(
        `Cleanup: ${result.count} AI chats deleted (> 6 months inactive)`,
      );
    }

    return result.count;
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
