import { Injectable } from '@nestjs/common';
import { LeadsService } from '../leads/leads.service';
import { LegalCasesService } from '../legal-cases/legal-cases.service';
import { CaseDocumentsService } from '../case-documents/case-documents.service';
import { HonorariosService } from '../honorarios/honorarios.service';

@Injectable()
export class McpToolsService {
  constructor(
    private leads: LeadsService,
    private legalCases: LegalCasesService,
    private caseDocs: CaseDocumentsService,
    private honorarios: HonorariosService,
  ) {}

  async callTool(name: string, args: Record<string, any>, user: any): Promise<unknown> {
    const tenantId = user?.tenant_id;
    const userId = user?.sub;
    const role = user?.role;
    const lawyerId = role === 'ADMIN' ? undefined : userId;

    switch (name) {
      // ─── Clientes ─────────────────────────────────────────────
      case 'buscar_cliente': {
        if (args.id) return this.leads.findOne(args.id, tenantId);
        return this.leads.findAll(tenantId, undefined, 1, 10, args.query);
      }

      case 'listar_clientes': {
        return this.leads.findAll(
          tenantId,
          args.inboxId,
          args.page ?? 1,
          args.limit ?? 20,
          args.search,
          args.stage,
        );
      }

      case 'criar_cliente': {
        return this.leads.create({
          name: args.name,
          phone: args.phone,
          email: args.email,
          inbox_id: args.inbox_id,
          tenant_id: tenantId,
        });
      }

      case 'atualizar_cliente': {
        const { id, name, email, tags } = args;
        return this.leads.update(id, { name, email, tags }, tenantId);
      }

      // ─── Processos ────────────────────────────────────────────
      case 'buscar_processo': {
        if (args.id) return this.legalCases.findOne(args.id, tenantId);
        return this.legalCases.findAll(
          lawyerId, undefined, undefined, undefined, 1, 10, tenantId,
          undefined, args.numero_processo,
        );
      }

      case 'listar_processos_do_cliente': {
        return this.legalCases.findAll(
          lawyerId, args.stage, args.archived, undefined,
          undefined, undefined, tenantId, args.lead_id,
        );
      }

      case 'atualizar_status_processo': {
        return this.legalCases.updateStage(args.id, args.stage, userId, tenantId);
      }

      case 'criar_processo': {
        return this.legalCases.create({
          lead_id: args.lead_id,
          lawyer_id: userId,
          legal_area: args.legal_area,
          action_type: args.action_type,
          claim_value: args.claim_value,
          opposing_party: args.opposing_party,
          notes: args.notes,
          tenant_id: tenantId,
        });
      }

      // ─── Documentos ───────────────────────────────────────────
      case 'listar_documentos_do_cliente': {
        return this.caseDocs.findByCaseId(args.case_id, tenantId);
      }

      case 'buscar_documento': {
        const docs = await this.caseDocs.findByCaseId(args.case_id, tenantId) as any[];
        if (args.doc_id) {
          return docs.find((d: any) => d.id === args.doc_id) ?? null;
        }
        return docs;
      }

      case 'vincular_documento_ao_processo': {
        const { doc_id, ...rest } = args;
        return this.caseDocs.update(doc_id, rest, tenantId);
      }

      // ─── Honorários ───────────────────────────────────────────
      case 'consultar_honorarios_do_cliente': {
        return this.honorarios.findByCaseId(args.case_id, tenantId);
      }

      case 'listar_pagamentos_pendentes': {
        const honorarios = await this.honorarios.findByCaseId(args.case_id, tenantId) as any[];
        return honorarios.flatMap((h: any) =>
          (h.payments ?? []).filter((p: any) => p.status === 'PENDENTE' || p.status === 'ATRASADO'),
        );
      }

      case 'registrar_pagamento': {
        return this.honorarios.markPaid(args.payment_id, {}, tenantId);
      }

      default:
        throw new Error(`Ferramenta desconhecida: ${name}`);
    }
  }
}
