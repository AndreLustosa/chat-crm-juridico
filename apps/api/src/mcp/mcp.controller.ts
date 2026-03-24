import {
  Controller, Post, Body, Req, Res, HttpCode, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { Public } from '../auth/decorators/public.decorator';
import { McpToolsService } from './mcp-tools.service';

// ─── Tool definitions (schema exposed to Claude) ───────────────────────────────

const TOOLS = [
  {
    name: 'buscar_cliente',
    description: 'Busca um cliente/contato no CRM por nome, telefone, e-mail ou ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID interno do cliente (UUID)' },
        query: { type: 'string', description: 'Nome, telefone ou e-mail para busca textual' },
      },
    },
  },
  {
    name: 'listar_clientes',
    description: 'Lista clientes/contatos do CRM com paginação e filtros opcionais.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Página (padrão: 1)' },
        limit: { type: 'number', description: 'Itens por página (padrão: 20)' },
        search: { type: 'string', description: 'Filtrar por nome ou telefone' },
        stage: { type: 'string', description: 'Filtrar por etapa do lead' },
      },
    },
  },
  {
    name: 'criar_cliente',
    description: 'Cria um novo cliente/contato no CRM.',
    inputSchema: {
      type: 'object',
      required: ['name', 'phone'],
      properties: {
        name: { type: 'string', description: 'Nome completo' },
        phone: { type: 'string', description: 'Telefone com DDI sem símbolos (ex: 5511999999999)' },
        email: { type: 'string', description: 'E-mail' },
        inbox_id: { type: 'string', description: 'ID do inbox' },
      },
    },
  },
  {
    name: 'atualizar_cliente',
    description: 'Atualiza dados de um cliente/contato existente.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'ID do cliente' },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        stage: { type: 'string', description: 'Etapa do lead' },
        legal_area: { type: 'string' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'buscar_processo',
    description: 'Busca um processo/caso jurídico pelo ID interno ou pelo número do processo judicial.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID interno do processo (UUID)' },
        numero_processo: { type: 'string', description: 'Número do processo judicial' },
      },
    },
  },
  {
    name: 'listar_processos_do_cliente',
    description: 'Lista todos os processos/casos jurídicos de um cliente específico.',
    inputSchema: {
      type: 'object',
      required: ['lead_id'],
      properties: {
        lead_id: { type: 'string', description: 'ID do cliente (UUID)' },
        stage: { type: 'string', description: 'Filtrar por etapa (VIABILIDADE, PREPARACAO, PROTOCOLO, ACOMPANHAMENTO)' },
        archived: { type: 'boolean', description: 'Incluir arquivados' },
      },
    },
  },
  {
    name: 'atualizar_status_processo',
    description: 'Atualiza a etapa/status de um processo jurídico.',
    inputSchema: {
      type: 'object',
      required: ['id', 'stage'],
      properties: {
        id: { type: 'string', description: 'ID do processo' },
        stage: {
          type: 'string',
          enum: ['VIABILIDADE', 'PREPARACAO', 'PROTOCOLO', 'ACOMPANHAMENTO'],
          description: 'Nova etapa',
        },
      },
    },
  },
  {
    name: 'criar_processo',
    description: 'Cria um novo processo/caso jurídico vinculado a um cliente.',
    inputSchema: {
      type: 'object',
      required: ['lead_id'],
      properties: {
        lead_id: { type: 'string', description: 'ID do cliente' },
        legal_area: { type: 'string', description: 'Área jurídica (TRABALHISTA, CIVEL, CRIMINAL, PREVIDENCIARIO, FAMILIA)' },
        action_type: { type: 'string', description: 'Tipo de ação' },
        claim_value: { type: 'number', description: 'Valor da causa em reais' },
        opposing_party: { type: 'string', description: 'Parte contrária' },
        notes: { type: 'string', description: 'Observações' },
      },
    },
  },
  {
    name: 'listar_documentos_do_cliente',
    description: 'Lista todos os documentos de um processo/caso específico.',
    inputSchema: {
      type: 'object',
      required: ['case_id'],
      properties: {
        case_id: { type: 'string', description: 'ID do processo (UUID)' },
      },
    },
  },
  {
    name: 'buscar_documento',
    description: 'Retorna metadados de um documento. Se doc_id não informado, lista todos do caso.',
    inputSchema: {
      type: 'object',
      required: ['case_id'],
      properties: {
        case_id: { type: 'string', description: 'ID do processo' },
        doc_id: { type: 'string', description: 'ID do documento (opcional)' },
      },
    },
  },
  {
    name: 'vincular_documento_ao_processo',
    description: 'Atualiza metadados de um documento (nome, pasta, descrição).',
    inputSchema: {
      type: 'object',
      required: ['doc_id'],
      properties: {
        doc_id: { type: 'string', description: 'ID do documento' },
        name: { type: 'string', description: 'Novo nome' },
        folder: { type: 'string', description: 'Pasta (PETICOES, DOCUMENTOS, PROCURACAO, CONTRATOS, OUTROS)' },
        description: { type: 'string', description: 'Descrição' },
      },
    },
  },
  {
    name: 'consultar_honorarios_do_cliente',
    description: 'Consulta todos os honorários e pagamentos de um processo.',
    inputSchema: {
      type: 'object',
      required: ['case_id'],
      properties: {
        case_id: { type: 'string', description: 'ID do processo' },
      },
    },
  },
  {
    name: 'listar_pagamentos_pendentes',
    description: 'Lista parcelas de honorários com status PENDENTE ou ATRASADO.',
    inputSchema: {
      type: 'object',
      required: ['case_id'],
      properties: {
        case_id: { type: 'string', description: 'ID do processo' },
      },
    },
  },
  {
    name: 'registrar_pagamento',
    description: 'Registra uma parcela de honorário como PAGO.',
    inputSchema: {
      type: 'object',
      required: ['payment_id'],
      properties: {
        payment_id: { type: 'string', description: 'ID da parcela' },
        paid_at: { type: 'string', description: 'Data do pagamento ISO 8601 (padrão: hoje)' },
      },
    },
  },
];

// ─── Controller ────────────────────────────────────────────────────────────────

@Public()
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly toolsService: McpToolsService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: any,
  ) {
    // ── Auth ──
    const authHeader = req.headers['authorization'] as string | undefined;
    let user: any = null;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        user = this.jwtService.verify(authHeader.slice(7));
      } catch {
        return res.status(401).json(this.jsonRpcError(body?.id ?? null, -32600, 'Token inválido'));
      }
    } else {
      return res.status(401).json(this.jsonRpcError(body?.id ?? null, -32600, 'Authorization header requerido'));
    }

    // ── Batch support ──
    if (Array.isArray(body)) {
      const results = await Promise.all(body.map(req => this.dispatch(req, user)));
      const responses = results.filter(r => r !== null);
      return res.json(responses.length === 1 ? responses[0] : responses);
    }

    const response = await this.dispatch(body, user);
    if (response === null) {
      // Notification — no response per JSON-RPC spec
      return res.status(204).send();
    }
    return res.json(response);
  }

  private async dispatch(req: any, user: any): Promise<any> {
    const { jsonrpc, id, method, params } = req ?? {};

    // Notification (no id) — handle but don't respond
    const isNotification = id === undefined || id === null;

    try {
      switch (method) {
        case 'initialize':
          return this.reply(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'crm-juridico', version: '1.0.0' },
          });

        case 'notifications/initialized':
          return null; // notification, no response

        case 'ping':
          return this.reply(id, {});

        case 'tools/list':
          return this.reply(id, { tools: TOOLS });

        case 'tools/call': {
          const toolName = params?.name as string;
          const toolArgs = (params?.arguments ?? {}) as Record<string, any>;
          this.logger.log(`MCP tool call: ${toolName} by ${user?.email}`);
          try {
            const result = await this.toolsService.callTool(toolName, toolArgs, user);
            return this.reply(id, {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            });
          } catch (e: any) {
            return this.reply(id, {
              content: [{ type: 'text', text: `Erro: ${e.message}` }],
              isError: true,
            });
          }
        }

        default:
          if (isNotification) return null;
          return this.jsonRpcError(id, -32601, `Método desconhecido: ${method}`);
      }
    } catch (e: any) {
      this.logger.error(`MCP dispatch error: ${e.message}`);
      if (isNotification) return null;
      return this.jsonRpcError(id, -32603, 'Erro interno');
    }
  }

  private reply(id: any, result: unknown) {
    return { jsonrpc: '2.0', id, result };
  }

  private jsonRpcError(id: any, code: number, message: string) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
