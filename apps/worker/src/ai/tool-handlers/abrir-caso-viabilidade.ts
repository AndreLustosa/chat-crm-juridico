import type { ToolHandler, ToolContext } from '../tool-executor';
import { Logger } from '@nestjs/common';

/**
 * abrir_caso_viabilidade — Cria um novo LegalCase em stage=VIABILIDADE
 * quando um CLIENTE existente (is_client=true) menciona um assunto juridico
 * NOVO, diferente dos processos que ele ja tem.
 *
 * Use APENAS quando:
 *  - O lead eh cliente (is_client=true)
 *  - Ele menciona explicitamente outra demanda juridica (um novo problema,
 *    outro caso, outro assunto)
 *  - O assunto NAO eh sobre um processo existente dele
 *
 * Exemplos de fala do cliente que JUSTIFICAM chamar:
 *  - "Dr, agora tenho outro problema, queria tirar uma duvida"
 *  - "Alem do meu processo trabalhista, meu vizinho esta me processando"
 *  - "Minha mae precisa aposentar, voces cuidam disso?"
 *  - "Queria abrir outra acao, outra situacao"
 *
 * NUNCA chamar quando:
 *  - Cliente pergunta sobre processo ou evento EXISTENTE
 *  - Cliente responde confirmacao de algo
 *  - Cliente esta em qualificacao (is_client=false) — pra leads o fluxo
 *    eh triagem normal, NAO abrir caso ainda
 *
 * Efeitos:
 *  - Cria LegalCase stage=VIABILIDADE vinculado ao lead e a conversa atual
 *  - Atribui o mesmo advogado da conversa (ou do ultimo caso do cliente)
 *  - Notifica o advogado via Notification persistente
 *  - NAO muda o cliente (continua is_client=true)
 */
export class AbrirCasoViabilidadeHandler implements ToolHandler {
  name = 'abrir_caso_viabilidade';
  private readonly logger = new Logger(AbrirCasoViabilidadeHandler.name);

  async execute(
    params: {
      subject: string;
      legal_area?: string;
      urgency?: 'baixa' | 'media' | 'alta';
    },
    context: ToolContext,
  ): Promise<any> {
    const { prisma, leadId, conversationId, tenantId } = context;

    if (!prisma || !leadId) {
      return { success: false, error: 'Contexto invalido' };
    }

    const subject = (params.subject || '').trim();
    if (!subject) {
      return {
        success: false,
        error: 'Parametro "subject" e obrigatorio — descreva brevemente o novo assunto',
      };
    }

    // 1. Validar que o lead eh cliente
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, phone: true, is_client: true, tenant_id: true },
    });

    if (!lead) {
      return { success: false, error: 'Lead nao encontrado' };
    }

    if (!lead.is_client) {
      return {
        success: false,
        error:
          'Esta tool eh exclusiva pra CLIENTES existentes (is_client=true). ' +
          'Este lead ainda esta em qualificacao — use o fluxo normal de triagem, ' +
          'nao abra um caso em Viabilidade ainda.',
      };
    }

    // 2. Verificar duplicata recente (ultimas 24h) — evita abrir 2 casos iguais
    // se o cliente reforcar a mesma demanda em mensagens proximas
    const recentViabilidade = await prisma.legalCase.findFirst({
      where: {
        lead_id: leadId,
        stage: 'VIABILIDADE',
        archived: false,
        created_at: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      },
      select: { id: true, created_at: true, notes: true, legal_area: true },
    });
    if (recentViabilidade) {
      return {
        success: true,
        case_id: recentViabilidade.id,
        message:
          'Ja existe um caso em Viabilidade aberto nas ultimas 24h pra este cliente. ' +
          'Nao duplicamos. Se o novo assunto e diferente, avise o advogado pra atualizar ' +
          'as anotacoes do caso existente.',
        duplicate: true,
      };
    }

    // 3. Determinar lawyer_id — cascata:
    //    (a) advogado atribuido a esta conversa
    //    (b) advogado do ultimo caso ativo do cliente
    //    (c) qualquer ADVOGADO/ADMIN do tenant (fallback)
    let lawyerId: string | undefined;

    if (conversationId) {
      const convo = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { assigned_lawyer_id: true },
      });
      lawyerId = convo?.assigned_lawyer_id ?? undefined;
    }

    if (!lawyerId) {
      const lastCase = await prisma.legalCase.findFirst({
        where: { lead_id: leadId, archived: false },
        orderBy: { created_at: 'desc' },
        select: { lawyer_id: true },
      });
      lawyerId = lastCase?.lawyer_id ?? undefined;
    }

    if (!lawyerId) {
      const anyLawyer = await prisma.user.findFirst({
        where: {
          roles: { hasSome: ['ADVOGADO', 'Advogados', 'ADMIN'] },
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        select: { id: true },
      });
      lawyerId = anyLawyer?.id ?? undefined;
    }

    if (!lawyerId) {
      return {
        success: false,
        error: 'Nao ha nenhum advogado/admin disponivel no sistema pra atribuir o caso',
      };
    }

    // 4. Normalizar legal_area (aceita variacoes comuns)
    const areaRaw = (params.legal_area || '').toLowerCase().trim();
    const areaMap: Record<string, string> = {
      trabalhista: 'Trabalhista',
      civel: 'Civel',
      cível: 'Civel',
      civil: 'Civel',
      previdenciario: 'Previdenciario',
      previdenciário: 'Previdenciario',
      consumidor: 'Consumidor',
      familia: 'Familia',
      família: 'Familia',
      criminal: 'Criminal',
      tributario: 'Tributario',
      tributário: 'Tributario',
      empresarial: 'Empresarial',
    };
    const legalArea = areaRaw ? (areaMap[areaRaw] || params.legal_area) : null;

    const urgency = params.urgency && ['baixa', 'media', 'alta'].includes(params.urgency)
      ? params.urgency
      : 'media';

    // 5. Criar o LegalCase
    const notesLines = [
      '== Caso aberto automaticamente pela IA ==',
      `Descricao: ${subject}`,
      `Urgencia: ${urgency}`,
      legalArea ? `Area: ${legalArea}` : null,
      `Aberto em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Maceio' })}`,
      `Fonte: conversa WhatsApp (conv_id=${conversationId || 'sem-conv'})`,
      '',
      'Acoes sugeridas:',
      '  - Avaliar viabilidade juridica',
      '  - Retornar ao cliente com orientacao / orcamento',
      '  - Promover pra ACOMPANHAMENTO se aceito ou arquivar se inviavel',
    ].filter(Boolean).join('\n');

    let legalCase: { id: string };
    try {
      legalCase = await prisma.legalCase.create({
        data: {
          lead_id: leadId,
          lawyer_id: lawyerId,
          conversation_id: conversationId,
          legal_area: legalArea,
          tenant_id: tenantId,
          stage: 'VIABILIDADE',
          priority: urgency === 'alta' ? 'ALTA' : urgency === 'baixa' ? 'BAIXA' : 'NORMAL',
          notes: notesLines,
        },
        select: { id: true },
      });
      this.logger.log(
        `[AbrirCaso] Caso ${legalCase.id} criado em VIABILIDADE pra cliente ${lead.phone} (lawyer ${lawyerId})`,
      );
    } catch (e: any) {
      this.logger.error(`[AbrirCaso] Erro ao criar LegalCase: ${e.message}`);
      return { success: false, error: `Falha ao criar caso: ${e.message}` };
    }

    // 6. Notificar advogado via tabela Notification (persistente).
    // Socket.io real-time fica a cargo do ChatGateway (nao temos acesso direto
    // daqui — o Notification vai aparecer quando o frontend poller ou a
    // proxima conexao socket fizer fetch).
    try {
      await prisma.notification.create({
        data: {
          user_id: lawyerId,
          tenant_id: tenantId || null,
          notification_type: 'new_case_inquiry',
          title: `Novo caso em Viabilidade — ${lead.name || 'Cliente'}`,
          body: `${subject.slice(0, 180)}${subject.length > 180 ? '...' : ''}`,
          data: {
            caseId: legalCase.id,
            leadId: lead.id,
            urgency,
            legal_area: legalArea,
            source: 'ai_chat',
          },
        },
      });
    } catch (e: any) {
      this.logger.warn(`[AbrirCaso] Falha ao criar Notification: ${e.message}`);
      // Nao bloqueia — o caso ja foi criado, notification eh complementar
    }

    return {
      success: true,
      case_id: legalCase.id,
      legal_area: legalArea,
      urgency,
      message:
        `Caso aberto em Viabilidade com sucesso. ` +
        `O advogado foi notificado. ` +
        `Ao responder ao cliente, confirme que o novo assunto foi registrado e ` +
        `que o time vai avaliar e retornar.`,
    };
  }
}
