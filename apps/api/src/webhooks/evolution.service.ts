import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ChatGateway } from '../gateway/chat.gateway';
import { LeadsService } from '../leads/leads.service';
import { InboxesService } from '../inboxes/inboxes.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { FollowupService } from '../followup/followup.service';
import { AdminBotService } from '../admin-bot/admin-bot.service';
import { MediaDownloadService } from '../media/media-download.service';
import { MessagesService } from '../messages/messages.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';
import { tenantOrDefault } from '../common/constants/tenant';

interface EvolutionWebhookPayload {
  event: string;
  instanceId?: string;
  instance?: string;
  data: any;
}

/**
 * Gera um resumo compacto do payload para logging.
 * Remove campos binários (jpegThumbnail, mediaKey, fileSha256, etc.)
 * que chegam como objetos de centenas de inteiros e tornam o log ilegível.
 */
function summarizePayload(payload: EvolutionWebhookPayload): string {
  try {
    const data = payload?.data ?? {};
    const msg = data?.message ?? {};
    const msgType =
      data?.messageType ||
      Object.keys(msg).find((k) => k.endsWith('Message') || k.endsWith('Audio')) ||
      'unknown';

    return JSON.stringify({
      event: payload?.event,
      instance: payload?.instance || payload?.instanceId,
      sender: data?.key?.remoteJid,
      fromMe: data?.key?.fromMe,
      messageId: data?.key?.id,
      messageType: msgType,
      pushName: data?.pushName,
      timestamp: data?.messageTimestamp,
      status: data?.status,
    });
  } catch {
    return '[erro ao resumir payload]';
  }
}

/**
 * Extrai o melhor número de telefone de dois JIDs do Evolution API.
 *
 * O WhatsApp Multi-Device pode enviar LIDs (Linked Device Identifiers)
 * como JID primário em alguns eventos. LIDs usam o sufixo "@lid" e NÃO
 * são números de telefone reais — o telefone real, quando disponível,
 * vem em remoteJidAlt (@s.whatsapp.net).
 *
 * Importante: LIDs podem ter 13 dígitos (ex: "3174081540241"), então a
 * heurística de contagem de dígitos sozinha não é confiável. O sufixo
 * "@lid" é o indicador definitivo.
 *
 * Esta função sempre prefere o JID que parece um número de telefone real.
 */
// Bug fix 2026-05-10 (Webhooks PR3 #21): constante centralizando o limite
// de dígitos pra "telefone real" (vs LID). Antes hardcoded em 6 lugares
// diferentes (extractPhone, handleChatsUpsert filter, contacts handlers, etc).
// Mudanca de regra (ex: numero internacional 14+) requer atualizar so aqui.
// 13 = DDI(2) + DDD(2) + 9 dígitos (BR padrao Anatel pos-2012).
const MAX_PHONE_DIGITS = 13;

function extractPhone(remoteJid: string, remoteJidAlt?: string): string {
  const p1 = (remoteJid || '').split('@')[0];
  const p2 = (remoteJidAlt || '').split('@')[0];

  // Bug fix 2026-05-10 (Webhooks PR3 #17): @lid checado em AMBOS os JIDs.
  // Antes so checava remoteJid — algumas versoes da Evolution mandam o
  // LID em remoteJidAlt e o telefone real em remoteJid. Sem o check no
  // p2, LID era retornado como "phone" e virava lead fantasma no banco.
  if ((remoteJid || '').endsWith('@lid')) return p2 || '';
  if ((remoteJidAlt || '').endsWith('@lid')) return p1 || '';

  // Heurística de fallback: telefones reais têm no máximo MAX_PHONE_DIGITS
  // dígitos (DDI+DDD+número). LIDs do WhatsApp geralmente têm 14+ dígitos
  const looksLikePhone = (p: string) => p.length > 0 && p.length <= MAX_PHONE_DIGITS;

  if (!p2) return p1;
  if (looksLikePhone(p2) && !looksLikePhone(p1)) return p2; // p1 é LID, p2 é telefone
  if (!looksLikePhone(p2) && looksLikePhone(p1)) return p1; // p2 é LID, p1 é telefone
  return p2 || p1; // Ambos parecem telefone (ou ambos LID) → mantém comportamento original
}

@Injectable()
export class EvolutionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EvolutionService.name);

  // Bug fix 2026-05-10 (Webhooks PR2 #10): singleton lock por instanceName
  // pra evitar resyncs concorrentes (cron + webhook + manual + startup).
  // Set in-memory — perdido em restart, ok (proximo trigger reabre).
  private readonly activeResyncs = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private leadsService: LeadsService,
    private inboxesService: InboxesService,
    @InjectQueue('media-jobs') private mediaQueue: Queue,
    @InjectQueue('ai-jobs') private aiQueue: Queue,
    // memoryQueue: trigger self-update do LeadProfile apos cada mensagem
    // (qualquer direcao). Memoria fresh em ~5-10s sem depender do cron 0h.
    @InjectQueue('memory-jobs') private memoryQueue: Queue,
    private whatsappService: WhatsappService,
    private moduleRef: ModuleRef,
    private adminBotService: AdminBotService,
    private mediaDownloadService: MediaDownloadService,
    private cronRunner: CronRunnerService,
  ) {}

  async handleMessagesUpsert(payload: EvolutionWebhookPayload) {
    const instanceName = payload?.instance || payload?.instanceId;
    this.logger.log(`[WEBHOOK] messages.upsert received from ${instanceName ?? 'unknown'}`);
    this.logger.debug(`Payload: ${summarizePayload(payload)}`);
    const dataPayload = payload?.data as any;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;

    // Defesa em profundidade: se a instancia nao esta cadastrada, REJEITA
    // o webhook. Antes loguava warning e seguia, o que permitiu Evolution
    // server compartilhado entre 2 escritorios contaminar este banco com
    // mensagens/leads do outro tenant (incidente 2026-04-29: instancia
    // AGENTE pertencia ao Lexcon mas o webhook caia aqui).
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] messages.upsert de instancia nao registrada "${instanceName}" — payload descartado pra evitar contaminacao cross-tenant`);
      return;
    }

    if (!inbox.tenant_id) {
      this.logger.warn(`[WEBHOOK-REJECT] Inbox da instância "${instanceName}" existe mas tenant_id é null — payload descartado para evitar lead órfão`);
      return;
    }

    const inboxId = inbox?.inbox_id || null;

    const messages = Array.isArray(dataPayload?.messages)
      ? (dataPayload.messages as any[])
      : [dataPayload];

    for (const data of messages) {
      if (!data) continue;
      const key = data.key as any;
      if (!key) continue;

      const remoteJid = key.remoteJid as string;
      const remoteJidAlt = key.remoteJidAlt as string;
      if (!remoteJid || remoteJid.includes('@g.us')) continue;

      // ─── Handle incoming reactions ───────────────────────────────
      if (data.message?.reactionMessage) {
        const reaction = data.message.reactionMessage;
        const reactionKey = reaction.key;
        const emoji = reaction.text || '';
        if (reactionKey?.id) {
          const targetMsg = await this.prisma.message.findUnique({
            where: { external_message_id: reactionKey.id },
          });
          if (targetMsg) {
            if (emoji === '') {
              await (this.prisma as any).messageReaction.deleteMany({
                where: { message_id: targetMsg.id, contact_jid: remoteJid },
              });
            } else {
              await (this.prisma as any).messageReaction.upsert({
                where: { message_id_contact_jid: { message_id: targetMsg.id, contact_jid: remoteJid } },
                update: { emoji },
                create: { message_id: targetMsg.id, contact_jid: remoteJid, emoji },
              });
            }
            const allReactions = await (this.prisma as any).messageReaction.findMany({
              where: { message_id: targetMsg.id },
            });
            this.chatGateway.emitMessageReaction(targetMsg.conversation_id, {
              messageId: targetMsg.id,
              reactions: allReactions,
            });
          }
        }
        continue;
      }

      const phone = extractPhone(remoteJid, remoteJidAlt);

      // LIDs (Linked Device Identifiers) são números internos do WhatsApp Multi-Device
      // com 14+ dígitos — NÃO são telefones reais. Quando a Evolution API envia o webhook
      // @lid sem remoteJidAlt, extractPhone retorna o LID como "telefone", criando leads
      // fantasma. A versão com telefone real (@s.whatsapp.net) sempre chega separadamente.
      const looksLikeRealPhone = phone.length > 0 && phone.length <= MAX_PHONE_DIGITS;
      if (!looksLikeRealPhone) {
        this.logger.debug(`[WEBHOOK] Ignorando LID ${phone} (${phone.length} dígitos) — não é telefone real`);
        continue;
      }

      // pushName from outgoing messages (fromMe=true) is the business account name, not the client.
      // Only use it as the contact name for incoming messages.
      const isFromMe = key.fromMe === true;
      const pushName = !isFromMe ? ((data.pushName as string) || null) : null;
      const messageContentCheck =
        (data.message?.conversation as string) ||
        (data.message?.extendedTextMessage?.text as string) ||
        '';

      // ── Admin Command Bot ──────────────────────────────────────────────────
      // Mensagens vindas de um admin/advogado do sistema são interceptadas aqui
      // para serem processadas como comandos CRM via IA (function calling).
      if (!isFromMe && messageContentCheck && await this.adminBotService.isEnabled()) {
        const sessionKey = `${instanceName}:${phone}`;
        if (this.adminBotService.isAdminCommand(sessionKey, messageContentCheck)) {
          const adminUser = await this.adminBotService.findAdminByPhone(phone);
          if (adminUser && instanceName) {
            this.logger.log(`[ADMIN-BOT] Comando do admin ${phone} interceptado: "${messageContentCheck.substring(0, 60)}"`);
            await this.adminBotService.handle(
              instanceName,
              phone,
              messageContentCheck,
              adminUser.id,
              adminUser.tenant_id,
            ).catch((err) => this.logger.error(`[ADMIN-BOT] Erro ao processar comando: ${err.message}`));
            continue; // Não processar como mensagem de cliente
          }
        }
      }
      // ── Fim Admin Command Bot ──────────────────────────────────────────────
      const externalMessageId = key.id as string;
      const messageContent =
        (data.message?.conversation as string) ||
        (data.message?.extendedTextMessage?.text as string) ||
        (data.message?.listResponseMessage?.singleSelectReply?.selectedRowId as string) ||
        (data.message?.listResponseMessage?.title as string) ||
        (data.message?.buttonsResponseMessage?.selectedDisplayText as string) ||
        '';
      const messageType = (data.messageType as string) || 'text';

      // 1. Upsert Lead (via LeadsService para garantir normalização)
      // stage não é passado: o upsert nunca sobrescreve stage em updates existentes,
      // e em creates o campo usa o default 'QUALIFICANDO' definido no schema Prisma.
      // tenant_id (via tenant.connect) eh OBRIGATORIO pos-bug 2026-04-29: sem
      // ele, o upsert busca/cria com tenant_id=null e dois escritorios passam
      // a brigar pelo mesmo registro.
      // pushName vai pra `whatsapp_push_name` (referencia do operador), nunca
      // pra `name` — antes (pre 2026-05-06) misturava ambos e a IA acabava
      // chamando o lead pelo apelido do WhatsApp ("Toninho", "Mae", etc).
      // So passa o campo se pushName tem valor, pra nao apagar o existente
      // em mensagens fromMe (onde pushName eh null).
      const lead = await this.leadsService.upsert(
        {
          phone,
          ...(pushName ? { whatsapp_push_name: pushName } : {}),
          origin: 'whatsapp',
          ...(inbox?.tenant_id ? { tenant: { connect: { id: inbox.tenant_id } } } : {}),
        } as any,
        inboxId, // isola notificacao de lead novo ao inbox do setor
      );

      // 1b. Lead PERDIDO voltou a falar → reativar para QUALIFICANDO
      // Sem isso, a conversa existe mas fica invisível no inbox (filtro de stage).
      //
      // Bug fix 2026-05-15: FINALIZADO foi REMOVIDO desta lista. Andre quer
      // que contatos arquivados (stage=FINALIZADO/ENCERRADO via processo
      // arquivado OU botao "Arquivar contato") permanecam ocultos mesmo
      // quando respondem. A IA continua respondendo via conv.ai_mode, mas o
      // lead nao volta pra inbox ativo. Antes, qualquer cliente com processo
      // finalizado que mandasse "obrigado" reaparecia em Leads, criando
      // ruido visual e re-trabalho pro operador.
      if (!isFromMe && ['PERDIDO'].includes(lead.stage)) {
        // Bug fix 2026-05-10 (Webhooks PR3 #18): preservar loss_reason
        // em LeadStageHistory ANTES de zerar. Antes informacao era
        // perdida — analise post-incidente perdia o motivo da perda
        // original. Agora fica audit trail.
        if (lead.loss_reason) {
          await this.prisma.leadStageHistory.create({
            data: {
              lead_id: lead.id,
              from_stage: lead.stage,
              to_stage: 'QUALIFICANDO',
              loss_reason: lead.loss_reason,
              // actor_id null — reativacao automatica pelo webhook,
              // nao tem operador humano associado
            },
          }).catch((e: any) => {
            this.logger.warn(`[REACTIVATE] Falha ao gravar LeadStageHistory: ${e.message}`);
          });
        }

        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            stage: 'QUALIFICANDO',
            stage_entered_at: new Date(),
            loss_reason: null,
          },
        });
        (lead as any).stage = 'QUALIFICANDO';
        this.logger.log(`[REACTIVATE] Lead ${lead.id} (${phone}) voltou a falar — stage ${lead.stage} → QUALIFICANDO`);
      }

      // 2. Find or Create Conversation
      // Busca em 2 etapas: primeiro com instance_name exato, depois sem — evita
      // criar duplicatas quando instance_name era null ou mudou.
      let conv = await this.prisma.conversation.findFirst({
        where: {
          lead_id: lead.id,
          channel: 'whatsapp',
          status: 'ABERTO',
          instance_name: instanceName,
        },
        orderBy: { last_message_at: 'desc' },
      });
      if (!conv) {
        // Fallback: qualquer ABERTO deste lead+channel (instance_name null ou antigo)
        conv = await this.prisma.conversation.findFirst({
          where: { lead_id: lead.id, channel: 'whatsapp', status: 'ABERTO' },
          orderBy: { last_message_at: 'desc' },
        });
        if (conv) {
          conv = await this.prisma.conversation.update({
            where: { id: conv.id },
            data: {
              instance_name: instanceName,
              ...(inboxId && !conv.inbox_id ? { inbox_id: inboxId } : {}),
            },
          });
          this.logger.log(`[ADOPT] Conversa ${conv.id} adotada pela instância ${instanceName} (era ${conv.instance_name ?? 'null'})`);
        }
      }
      if (!conv) {
        // 1) Tentar reabrir conversa FECHADO (qualquer instance)
        const closedConv = await this.prisma.conversation.findFirst({
          where: { lead_id: lead.id, channel: 'whatsapp', status: 'FECHADO' },
          orderBy: { last_message_at: 'desc' },
        });
        if (closedConv) {
          conv = await this.prisma.conversation.update({
            where: { id: closedConv.id },
            data: {
              status: 'ABERTO',
              last_message_at: new Date(),
              assigned_user_id: null,
              instance_name: instanceName,
              ...(inboxId && !closedConv.inbox_id ? { inbox_id: inboxId } : {}),
              ...(instanceName && !closedConv.instance_name ? { instance_name: instanceName } : {}),
              ...(!closedConv.tenant_id ? { tenant_id: inbox?.tenant_id || lead.tenant_id } : {}),
            },
          });
          this.logger.log(`[REOPEN] Conversa ${conv.id} reaberta para lead ${lead.id} (operador resetado)`);
        }
        // 2) Se não achou FECHADO, checar ADIADO — mantém status, só atualiza timestamp
        if (!conv) {
          const adiadoConv = await this.prisma.conversation.findFirst({
            where: { lead_id: lead.id, channel: 'whatsapp', status: 'ADIADO' },
            orderBy: { last_message_at: 'desc' },
          });
          if (adiadoConv) {
            conv = await this.prisma.conversation.update({
              where: { id: adiadoConv.id },
              // Self-heal de legados: se inbox_id/instance_name/tenant_id estavam
              // null no registro antigo, preenche agora pra normalizar.
              data: {
                last_message_at: new Date(),
                instance_name: instanceName,
                ...(inboxId && !adiadoConv.inbox_id ? { inbox_id: inboxId } : {}),
                ...(!adiadoConv.tenant_id ? { tenant_id: inbox?.tenant_id || lead.tenant_id } : {}),
              },
            });
            this.logger.log(`[ADIADO] Conversa ${conv.id} recebeu msg mas permanece ADIADO`);
          }
        }
        // 3) Criar nova apenas se não encontrou NENHUMA conversa existente
        if (!conv) {
          conv = await this.prisma.conversation.create({
            data: {
              lead_id: lead.id,
              channel: 'whatsapp',
              status: 'ABERTO',
              external_id: `${phone}@s.whatsapp.net`,
              inbox_id: inboxId,
              instance_name: instanceName,
              tenant_id: inbox?.tenant_id || lead.tenant_id,
            },
          });
        }
      } else {
        // Self-heal de conversas existentes: preenche inbox_id, instance_name
        // e tenant_id quando estiverem null no registro antigo. Idempotente —
        // só faz update se houver algo de fato pra patchar.
        const convPatch: any = {};
        if (!conv.inbox_id && inboxId) convPatch.inbox_id = inboxId;
        if (!conv.instance_name && instanceName) convPatch.instance_name = instanceName;
        if (!conv.tenant_id) convPatch.tenant_id = inbox?.tenant_id || lead.tenant_id;
        if (Object.keys(convPatch).length > 0) {
          conv = await this.prisma.conversation.update({
            where: { id: conv.id },
            data: convPatch,
          });
        }
      }

      // ── Auto-merge de conversa LID ─────────────────────────────────────────
      // Se o remoteJid era um @lid e conseguimos o telefone real via remoteJidAlt,
      // verifica se existe uma conversa "gêmea" do LID e mescla todas as mensagens
      // na conversa do telefone real, encerrando a do LID.
      // Usa sufixo @lid (confiável) em vez de contagem de dígitos (LIDs podem ter 13 dígitos).
      const rawLidPhone = remoteJid.split('@')[0];
      if (remoteJid.endsWith('@lid') && phone !== rawLidPhone) {
        // Auto-merge so isola por tenant — antes podia juntar conversas de
        // tenants distintos com o mesmo LID (bug 2026-04-29).
        const lidLead = await this.prisma.lead.findFirst({
          where: {
            phone: rawLidPhone,
            ...(inbox?.tenant_id ? { tenant_id: inbox.tenant_id } : {}),
          },
        });
        if (lidLead && lidLead.id !== lead.id) {
          const lidConvs = await this.prisma.conversation.findMany({
            where: { lead_id: lidLead.id, channel: 'whatsapp' },
            select: { id: true, tenant_id: true, status: true },
          });
          for (const lidConv of lidConvs) {
            // Bug fix 2026-05-10 (Webhooks PR2 #7): revalida tenant ANTES
            // do updateMany. Antes verificavamos so o lidLead.tenant_id no
            // findFirst, mas conv.tenant_id pode estar diferente devido a
            // self-healing em cascata (legacy tenant_id=null vira inbox.tenant_id
            // quando o webhook anterior do mesmo lead disparou o heal).
            // Sem essa revalidacao, podiamos mover mensagens de conv com
            // tenant_id LEGACY pra conv do tenant atual — embaralhando
            // historico cross-tenant.
            const convTenantId = conv.tenant_id ?? null;
            const lidConvTenantId = lidConv.tenant_id ?? null;
            if (convTenantId && lidConvTenantId && convTenantId !== lidConvTenantId) {
              this.logger.warn(
                `[AUTO-MERGE-BLOCKED] LID conv ${lidConv.id} (tenant ${lidConvTenantId}) ` +
                `!= target conv ${conv.id} (tenant ${convTenantId}) — skip merge cross-tenant`,
              );
              continue;
            }
            // Move todas as mensagens da conversa LID → conversa do telefone real
            await this.prisma.message.updateMany({
              where: { conversation_id: lidConv.id },
              data: { conversation_id: conv.id },
            });
            // Fecha a conversa LID duplicada
            await this.prisma.conversation.update({
              where: { id: lidConv.id },
              data: { status: 'FECHADO' },
            });
            this.logger.log(
              `[AUTO-MERGE] Conv LID ${lidConv.id} (${rawLidPhone}) → conv telefone ${conv.id} (${phone}) — ${lidConvs.length} conv(s) mescladas`,
            );
          }
          // Notifica a inbox para atualizar (remove duplicata da tela)
          this.chatGateway.emitConversationsUpdate(conv.tenant_id ?? null, true);
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      // Auto-assign via round-robin — apenas entre operadores ONLINE
      // Se ninguém online: IA atende sozinha (ai_mode permanece true, sem assigned_user_id)
      // Quando o primeiro operador ficar online, as conversas pendentes serão atribuídas
      // automaticamente via ChatGateway.assignPendingConversations()
      if (!conv.assigned_user_id) {
        const onlineUserIds = this.chatGateway.getOnlineUserIds();
        const nextUserId: string | null = inboxId
          ? await this.inboxesService.getNextAssignee(inboxId, onlineUserIds)
          : null;

        if (nextUserId) {
          conv = await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { assigned_user_id: nextUserId },
            // ai_mode NÃO é alterado: operador monitora, IA continua respondendo
          });
          this.logger.log(`[AUTO-ASSIGN] Conversa ${conv.id} → operador online ${nextUserId}`);
        } else {
          // Ninguém online → IA atende sozinha (ai_mode já é true por default)
          this.logger.log(`[AUTO-ASSIGN] Nenhum operador online — IA atende conversa ${conv.id}`);
        }
      }

      // 3. Insert Message (idempotent)
      const existingMsg = await this.prisma.message.findUnique({
        where: { external_message_id: externalMessageId },
        include: { media: true, skill: { select: { id: true, name: true, area: true } } },
      });
      if (existingMsg) {
        this.logger.log(`[DEDUP] Mensagem já existe: ${externalMessageId} — re-emitindo WebSocket como fallback`);
        // Re-emite WebSocket para cobrir o caso em que o BullMQ QueueEvents perdeu o evento
        // (mensagem já está no banco mas o frontend pode não ter sido notificado em tempo real)
        this.chatGateway.emitNewMessage(existingMsg.conversation_id, existingMsg);
        // Bug fix 2026-05-10 (Webhooks PR3 #22): tenant fallback. Antes
        // se conv.tenant_id era null (lead legacy pre-hardening), emit
        // global afetava TODOS os tenants — frontend de tenant A fazia
        // refresh por mensagem do tenant B. Agora resolve via inbox.tenant_id
        // como fallback. Se ainda for null, skip emit (evita ruido global).
        const tenantForEmit = conv.tenant_id ?? inbox?.tenant_id ?? null;
        if (tenantForEmit) {
          this.chatGateway.emitConversationsUpdate(tenantForEmit, true);
        }
        continue;
      }

      // Para mensagens enviadas (fromMe=true / send.message echo), verifica se existe uma
      // mensagem "pendente" na mesma conversa com o mesmo texto salva em menos de 2 minutos.
      // Isso ocorre quando o CRM salva a mensagem com external_message_id sintético
      // (prefixos: 'out_*', 'sys_reminder_*', 'sys_followup_ia_*', 'sys_broadcast_*',
      // 'out_followup_ia_*', 'out_followup_manual_*') e depois o webhook chega com o
      // ID real do WhatsApp. Antes o filtro só cobria 'out_*', deixando passar
      // reminders/followups/broadcasts que ficavam duplicados.
      // Atualizado em 2026-04-23 apos bug reportado (duplicata de reminder da Dra. Gianny).
      if (isFromMe && messageContent) {
        const since = new Date(Date.now() - 2 * 60 * 1000); // janela de 2 minutos
        // Bug fix 2026-05-10 (Webhooks PR2 #6): orderBy explicito FIFO
        // (oldest first) + claim atomico. Antes findFirst sem orderBy podia
        // claim mensagens fora de ordem quando 2+ "Ok" iguais saiam em
        // sequencia rapida — segunda echo podia bater na primeira pending,
        // gerando mapping invertido entre out_X e real_Y.
        // Agora: ordena por created_at ASC (FIFO matches WhatsApp echo
        // ordering em sends sequenciais) + valida que o claim foi atomico
        // via updateMany WHERE external_message_id IN (out_, sys_).
        const pendingMsg = await this.prisma.message.findFirst({
          where: {
            conversation_id: conv.id,
            direction: 'out',
            text: messageContent,
            created_at: { gte: since },
            OR: [
              { external_message_id: { startsWith: 'out_' } },
              { external_message_id: { startsWith: 'sys_' } }, // sys_reminder_, sys_followup_ia_, sys_broadcast_
            ],
          },
          orderBy: { created_at: 'asc' },
          include: { media: true, skill: { select: { id: true, name: true, area: true } } },
        });
        if (pendingMsg) {
          // Claim atomico: updateMany com WHERE preserva prefixo sintetico —
          // se outro webhook concorrente ja claimou (race), updateMany
          // retorna 0 e seguimos pro fluxo de create normal (que vai cair
          // no catch P2002 se for o mesmo external_message_id).
          const claimResult = await this.prisma.message.updateMany({
            where: {
              id: pendingMsg.id,
              OR: [
                { external_message_id: { startsWith: 'out_' } },
                { external_message_id: { startsWith: 'sys_' } },
              ],
            },
            data: { external_message_id: externalMessageId, status: 'enviado' },
          });
          if (claimResult.count === 1) {
            const updated = await this.prisma.message.findUnique({
              where: { id: pendingMsg.id },
              include: { media: true, skill: { select: { id: true, name: true, area: true } } },
            });
            if (updated) this.chatGateway.emitMessageUpdate(conv.id, updated);
            this.logger.log(`[DEDUP] Msg pendente ${pendingMsg.id} vinculada ao ID real ${externalMessageId}`);
            continue;
          }
          // claim perdeu pra concorrente — log e segue (fluxo normal de create)
          this.logger.log(`[DEDUP-RACE] Pending ${pendingMsg.id} claimed por outro webhook — seguindo fluxo normal`);
        }
      }

      let msgType = 'text';
      if (
        [
          'imageMessage',
          'audioMessage',
          'documentMessage',
          'videoMessage',
          'stickerMessage',
        ].includes(messageType)
      ) {
        msgType = messageType.replace('Message', '');
      }

      // Extract quoted/reply context from contextInfo (works for both conversation and extendedTextMessage)
      const contextInfo =
        (data.message?.extendedTextMessage?.contextInfo as any) ||
        (data.message?.conversation ? undefined : undefined) ||
        (data.message?.[messageType]?.contextInfo as any);
      const quotedStanzaId: string | undefined = contextInfo?.stanzaId;
      const quotedText: string | undefined =
        contextInfo?.quotedMessage?.conversation ||
        contextInfo?.quotedMessage?.extendedTextMessage?.text ||
        contextInfo?.quotedMessage?.imageMessage?.caption;

      let replyToId: string | null = null;
      let replyToText: string | null = quotedText || null;
      if (quotedStanzaId) {
        const quotedMsg = await this.prisma.message.findUnique({
          where: { external_message_id: quotedStanzaId },
        });
        replyToId = quotedMsg?.id || null;
        if (!replyToText && quotedMsg?.text) replyToText = quotedMsg.text;
      }

      const isOutgoing = isFromMe;
      // Bug fix 2026-05-10 (Webhooks PR2 #4): try/catch P2002 unique violation.
      // Antes findUnique + create separados podiam race com retry da Evolution
      // (maxRetries:5, retryDelay:15s). Em pico ou timeout breve, 2 webhooks
      // concorrentes do MESMO messageId entravam no create e o segundo crashava
      // com 500 → Evolution re-tentava em loop, log spam + msg orfa.
      // Agora P2002 = "outro webhook ja criou" — recupera via findUnique e
      // segue como [DEDUP].
      let msg: any;
      try {
        msg = await this.prisma.message.create({
          data: {
            conversation_id: conv.id,
            direction: isOutgoing ? 'out' : 'in',
            type: msgType,
            text: messageContent,
            external_message_id: externalMessageId,
            status: isOutgoing ? 'enviado' : 'recebido',
            reply_to_id: replyToId,
            reply_to_text: replyToText,
          },
        });
      } catch (createErr: any) {
        if (createErr?.code === 'P2002') {
          this.logger.log(`[DEDUP-RACE] external_message_id=${externalMessageId} criado por webhook concorrente — re-emit`);
          const concurrentMsg = await this.prisma.message.findUnique({
            where: { external_message_id: externalMessageId },
            include: { media: true, skill: { select: { id: true, name: true, area: true } } },
          });
          if (concurrentMsg) {
            this.chatGateway.emitNewMessage(concurrentMsg.conversation_id, concurrentMsg);
            // Bug fix 2026-05-10 (PR3 #22): tenant fallback (mesmo que o
            // [DEDUP] path acima). Skip emit se tenant null pra evitar
            // ruido global cross-tenant.
            const tenantForEmit = conv.tenant_id ?? inbox?.tenant_id ?? null;
            if (tenantForEmit) {
              this.chatGateway.emitConversationsUpdate(tenantForEmit, true);
            }
          }
          continue;
        }
        // Outros erros: re-throw (DB indisponivel, schema mismatch, etc)
        throw createErr;
      }

      // Update Convo last message
      await this.prisma.conversation.update({
        where: { id: conv.id },
        data: { last_message_at: new Date() },
      });

      // ─── 4. Emit newMessage IMEDIATAMENTE (frontend vê a mensagem já) ───
      // Para mídia: emite sem media record, frontend mostra "Baixando..." por 10s
      // depois botão "Recarregar" se ainda não chegou.
      this.chatGateway.emitNewMessage(conv.id, msg);

      // ─── 5. Download de mídia em background (mesmo processo, não-await) ──
      // MediaDownloadService faz retry interno (3x com backoff 2s/5s/10s)
      // e emite messageUpdate ao final (sucesso ou falha final).
      // Sem worker BullMQ — fluxo simplificado estilo Chatwoot.
      if (msgType !== 'text') {
        const mediaData = (data.message as any)?.[messageType];
        this.mediaDownloadService.downloadAndStore({
          messageId: msg.id,
          conversationId: conv.id,
          externalMessageId,
          instanceName,
          mediaData,
        }).catch(err => {
          this.logger.error(`[MEDIA-SYNC] Erro inesperado para msg ${msg.id}: ${err.message}`);
        });
      }
      this.chatGateway.emitConversationsUpdate(conv.tenant_id ?? null, true);

      // Notify operator(s) about incoming message (sound + unread badge)
      if (!isOutgoing) {
        this.chatGateway.emitIncomingMessageNotification(
          conv.tenant_id ?? null,
          conv.inbox_id ?? null,
          conv.assigned_user_id || null,
          { conversationId: conv.id, contactName: lead.name || lead.phone },
          conv.assigned_lawyer_id || null,
          lead.is_client,
        );

        // ─── Response Listener: verifica se é resposta a um follow-up ─────
        if (messageContent && messageContent.length >= 3) {
          this.checkFollowupResponse(lead.id, messageContent).catch(e =>
            this.logger.warn(`[FOLLOWUP-LISTENER] ${e.message}`),
          );
        }
      }

      // 5. Se AI_Mode ativo e mensagem recebida (não enviada), agenda job para a IA responder
      // Debounce: cancela job pendente e cria novo com timer resetado, acumulando mensagens
      // rápidas. Quando o lead para de digitar, o job dispara e a IA responde tudo de uma vez.
      this.logger.debug(`[AI-CHECK] conv=${conv.id} ai_mode=${conv.ai_mode} isOutgoing=${isOutgoing}`);
      if (!isOutgoing && conv.ai_mode) {
        try {
          const cooldownRaw = await this.prisma.globalSetting.findUnique({
            where: { key: 'AI_COOLDOWN_SECONDS' },
          });
          const cooldownSeconds = cooldownRaw?.value ? parseInt(cooldownRaw.value, 10) : 8;
          const debounceMs = (isNaN(cooldownSeconds) ? 8 : Math.max(0, cooldownSeconds)) * 1000;
          const jobId = `ai-debounce-${conv.id}`;

          if (debounceMs > 0) {
            // ─── Debounce robusto baseado em estado do job ─────────────
            //
            // Antes: tentava existing.remove() e, se falhasse, enfileirava
            // SEM jobId fixo — resultando em 2-3 jobs paralelos quando
            // mensagens rapidas chegavam (bug 2026-05-08 Jhennify).
            //
            // Agora: lemos o estado REAL do job e decidimos:
            //   - delayed/waiting -> changeDelay() pra resetar timer no
            //     job existente (sem criar duplicado). Se changeDelay
            //     falhar, remove + recria com mesmo jobId.
            //   - active -> NAO enfileira novo. O worker que ja esta
            //     processando vai ler as mensagens novas do DB no comeco.
            //     A proxima mensagem do lead, se vier, dispara um novo
            //     ciclo (porque ai o jobId atual ja terminou).
            //   - completed/failed -> remove + recria.
            //   - sem job -> cria novo.
            const existing = await this.aiQueue.getJob(jobId);
            let action: 'created' | 'reset' | 'skipped' = 'created';

            if (existing) {
              let state: string;
              try {
                state = await existing.getState();
              } catch (e: any) {
                this.logger.warn(`[AI] Debounce: getState falhou para ${jobId}: ${e.message}`);
                state = 'unknown';
              }

              if (state === 'delayed' || state === 'waiting') {
                // Job aguardando o timer — reseta o delay
                try {
                  // BullMQ v3+: changeDelay reseta o timer sem remover o job
                  if (typeof (existing as any).changeDelay === 'function') {
                    await (existing as any).changeDelay(debounceMs);
                    action = 'reset';
                    this.logger.log(`[AI] Debounce: timer do job ${jobId} resetado (state=${state})`);
                  } else {
                    // Fallback: remove + recria com mesmo jobId
                    await existing.remove();
                    action = 'created';
                  }
                } catch (e: any) {
                  this.logger.warn(`[AI] Debounce: changeDelay falhou (${e.message}), tentando remove+recreate`);
                  try {
                    await existing.remove();
                    action = 'created';
                  } catch {
                    // remove tambem falhou — provavelmente virou active
                    // entre as chamadas. Pula este ciclo; o job ativo
                    // vai ler as msgs novas do DB.
                    action = 'skipped';
                  }
                }
              } else if (state === 'active' || state === 'waiting-children') {
                // Job em execucao — nao enfileira outro. O worker ja vai
                // pegar as mensagens novas no findMany do DB.
                action = 'skipped';
                this.logger.log(`[AI] Debounce: job ${jobId} ja active — confiando no re-fetch do worker`);
              } else {
                // completed/failed/unknown — remove e cria novo
                try {
                  await existing.remove();
                } catch {
                  // ignora — pode ja ter sido removido pelo BullMQ
                }
                action = 'created';
              }
            }

            if (action === 'created') {
              await this.aiQueue.add(
                'process_ai_response',
                { conversation_id: conv.id, lead_id: lead.id },
                { jobId, delay: debounceMs, removeOnComplete: true, removeOnFail: false },
              );
              this.logger.log(`[AI] Debounce: job ${jobId} criado delay=${debounceMs}ms`);
            }
          } else {
            await this.aiQueue.add('process_ai_response', {
              conversation_id: conv.id,
              lead_id: lead.id,
            });
            this.logger.log(`[AI] Job enfileirado imediato para conv ${conv.id}`);
          }
        } catch (queueErr: any) {
          this.logger.error(`[AI] ERRO ao enfileirar job de IA: ${queueErr.message}`);
        }
      }

      // 5b. Conversa do operador humano (ai_mode=false): enfileira job apenas para
      // atualizar a Long Memory. O worker detecta ai_mode=false e só extrai fatos,
      // sem gerar resposta IA. Debounce de 15s para acumular mensagens rápidas.
      if (!isOutgoing && !conv.ai_mode) {
        const memJobId = `memory-debounce-${conv.id}`;
        const existing = await this.aiQueue.getJob(memJobId);
        if (existing) {
          try {
            await existing.remove();
          } catch {
            // Job ativo — será processado; a próxima mensagem pega no próximo ciclo
          }
        }
        await this.aiQueue.add(
          'process_ai_response',
          { conversation_id: conv.id, lead_id: lead.id },
          { jobId: memJobId, delay: 15_000, removeOnComplete: true, removeOnFail: false },
        );
      }

      // 5c. Self-update do LeadProfile — qualquer mensagem (cliente, IA ou
      // operador humano) dispara consolidacao debounced de 30s. Memoria
      // fresh sem depender do cron 0h.
      //
      // jobId fixo por lead = dedup natural. Rajada de N msgs vira 1
      // consolidacao 30s apos a ultima.
      //
      // Bug 2026-05-08 corrigido: 53% dos leads ativos sem LeadProfile
      // porque cron noturno so consolidava leads que ganharam Memory
      // entries no dia. Agora qualquer mensagem dispara update.
      if (lead.tenant_id) {
        try {
          await this.memoryQueue.add(
            'consolidate-profile',
            { tenant_id: lead.tenant_id, lead_id: lead.id },
            {
              jobId: `selfup-${lead.id}`,
              delay: 30_000, // 30s debounce — agrupa rajadas
              removeOnComplete: true,
              attempts: 2,
            },
          );
        } catch (e: any) {
          this.logger.warn(`[AI] Falha ao enfileirar self-update do profile: ${e.message}`);
        }
      }
    }
  }

  // ─── Response Listener: analisa respostas de leads em follow-up ──────────

  private async checkFollowupResponse(leadId: string, responseText: string): Promise<void> {
    if (!responseText || responseText.length < 3) return;

    // Verificar se lead tem enrollment ativo
    const enrollment = await this.prisma.followupEnrollment.findFirst({
      where: { lead_id: leadId, status: 'ATIVO' },
      include: {
        sequence: { include: { steps: { orderBy: { position: 'asc' } } } },
        lead: true,
      },
      orderBy: { enrolled_at: 'desc' },
    });
    if (!enrollment) return;

    this.logger.log(
      `[FOLLOWUP-LISTENER] Resposta recebida do lead ${leadId} em sequência "${enrollment.sequence.name}"`,
    );

    // Analisar intenção com IA (resolve via ModuleRef — sem circular dep em build)
    try {
      const followupSvc = this.moduleRef.get(FollowupService, { strict: false });
      if (!followupSvc) return;

      const dossie = {
        pessoa: { nome: enrollment.lead.name, estagio: enrollment.lead.stage },
        historico: {},
        tarefa: { categoria: enrollment.sequence.category },
      };
      const analise = await followupSvc.analyzeResponse(responseText, dossie);

      this.logger.log(
        `[FOLLOWUP-LISTENER] Análise: ${analise.intencao} | sentimento: ${analise.sentimento}`,
      );

      // Pausar sequência se respondeu positivamente (quer contratar) ou negativamente (recusando)
      if (['quer_contratar', 'confirmando'].includes(analise.intencao)) {
        await this.prisma.followupEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'CONVERTIDO' },
        });
        // Criar tarefa urgente para o advogado
        await this.prisma.task.create({
          data: {
            tenant_id: tenantOrDefault((enrollment.lead as { tenant_id?: string | null }).tenant_id),
            title: `Lead quente respondeu: ${enrollment.lead.name || enrollment.lead.phone}`,
            description: `Lead respondeu positivamente ao follow-up da sequência "${enrollment.sequence.name}".\n\nResposta: "${responseText}"\n\nAnálise IA: ${analise.resumo}\nPróxima ação sugerida: ${analise.proxima_acao}`,
            status: 'A_FAZER',
            due_at: new Date(Date.now() + 2 * 3600000), // 2 horas
            lead_id: leadId,
            assigned_user_id: null, // será assignado pelo responsável
          },
        });
        this.logger.log(`[FOLLOWUP-LISTENER] Lead convertido! Tarefa urgente criada.`);
      } else if (['recusando'].includes(analise.intencao)) {
        await this.prisma.followupEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'CANCELADO', paused_reason: `Lead recusou: ${analise.resumo}` },
        });
        this.logger.log(`[FOLLOWUP-LISTENER] Lead recusou. Sequência cancelada.`);
      } else if (analise.requer_humano) {
        await this.prisma.followupEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'PAUSADO', paused_reason: `Escalado para humano: ${analise.resumo}` },
        });
        await this.prisma.task.create({
          data: {
            tenant_id: tenantOrDefault((enrollment.lead as { tenant_id?: string | null }).tenant_id),
            title: `Revisão necessária: ${enrollment.lead.name || enrollment.lead.phone}`,
            description: `A IA detectou que este lead precisa de atenção humana.\n\nResposta: "${responseText}"\n\nMotivo: ${analise.resumo}`,
            status: 'A_FAZER',
            due_at: new Date(Date.now() + 4 * 3600000),
            lead_id: leadId,
            assigned_user_id: null,
          },
        });
        this.logger.log(`[FOLLOWUP-LISTENER] Escalado para humano. Sequência pausada.`);
      } else if (analise.intencao === 'pedindo_prazo') {
        // Aguardar 3 dias antes de continuar
        const resumeAt = new Date(Date.now() + 3 * 24 * 3600000);
        await this.prisma.followupEnrollment.update({
          where: { id: enrollment.id },
          data: { next_send_at: resumeAt, paused_reason: 'Lead pediu prazo para pensar' },
        });
        this.logger.log(`[FOLLOWUP-LISTENER] Lead pediu prazo — próximo envio em 3 dias`);
      }
    } catch (e: any) {
      this.logger.error(`[FOLLOWUP-LISTENER] Erro na análise: ${e.message}`);
    }
  }

  async handleChatsUpsert(payload: EvolutionWebhookPayload) {
    this.logger.debug(`Recebendo webhook de chats: ${summarizePayload(payload)}`);
    const dataPayload = payload?.data as any;
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] chats.upsert de instancia nao registrada "${instanceName}" — descartado`);
      return;
    }
    const inboxId = inbox?.inbox_id || null;

    const chats = Array.isArray(dataPayload)
      ? (dataPayload as any[])
      : [dataPayload];

    // ─── Proteção anti-flood na reconexão ──────────────────────────
    // Após reconectar a instância WhatsApp, a Evolution API envia chats.upsert
    // para TODOS os chats do dispositivo (1000+). Isso criava/reabria conversas
    // para contatos antigos, poluindo o inbox com leads irrelevantes.
    // Solução: chats.upsert NUNCA cria conversas novas nem reabre fechadas.
    // Apenas atualiza metadados (inbox_id, instance_name, foto) de conversas
    // já abertas. Conversas são criadas/reabertas APENAS via messages.upsert
    // (quando chega uma mensagem real).
    // ────────────────────────────────────────────────────────────────
    //
    // Bug fix 2026-05-10 (Webhooks PR2 #8): chunked processing + yield
    // event loop. Antes loop for sincrono processava 1000+ chats
    // sequencialmente — cada um faz findByPhone + lead.update +
    // conversation.findFirst + conversation.update + message.upsert +
    // conversation.update = 5+ queries. Total: 5000+ queries em rajada
    // bloqueando o event loop inteiro. Webhook subsequente (mensagem
    // de cliente real) ficava enfileirado ate a rajada acabar, gerando
    // timeout do Evolution e retry loop. Risco SIGKILL no API container
    // (igual incidente 2026-04-28 do scheduleResyncAfterReconnect).
    // Fix: processa em chunks de 25 + setImmediate entre chunks pra
    // liberar event loop.
    const CHUNK_SIZE = 25;
    if (chats.length > 100) {
      this.logger.log(`[chats.upsert] Processando ${chats.length} chats em chunks de ${CHUNK_SIZE}`);
    }

    for (let i = 0; i < chats.length; i++) {
      // Yield event loop entre chunks
      if (i > 0 && i % CHUNK_SIZE === 0) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const data = chats[i];
      if (!data) continue;

      const remoteJid = (data.remoteJidAlt || data.remoteJid) as string;
      if (!remoteJid || remoteJid.includes('@g.us')) continue;

      const phone = extractPhone(data.remoteJid as string, data.remoteJidAlt as string);
      if (phone.length > MAX_PHONE_DIGITS) continue; // LID, não é telefone real

      // Apenas atualizar leads existentes — NÃO criar novos via chats.upsert.
      // Filtra por tenant pra nao mexer em lead de outro escritorio quando
      // dois tenants tem o mesmo telefone (bug 2026-04-29).
      // Bug fix 2026-05-12 (Leads PR1 #C8): se inbox sem tenant_id, pula
      // (antes passava null e findByPhone aceitava — agora throw).
      if (!inbox?.tenant_id) continue;
      const existingLead = await this.leadsService.findByPhone(phone, inbox.tenant_id);
      if (!existingLead) continue;

      // Atualizar foto se disponível (URLs do WhatsApp expiram)
      const profilePicUrl = (data.profilePicUrl as string) || null;
      if (profilePicUrl && profilePicUrl !== existingLead.profile_picture_url) {
        await this.prisma.lead.update({
          where: { id: existingLead.id },
          data: { profile_picture_url: profilePicUrl },
        });
      }

      // Atualizar pushName do WhatsApp em campo separado — nunca mexer
      // em `name` (fonte de verdade pra IA, so SDR/site/manual preenchem).
      const pushName = (data.pushName as string) || (data.name as string) || null;
      if (pushName && (existingLead as any).whatsapp_push_name !== pushName) {
        await this.prisma.lead.update({
          where: { id: existingLead.id },
          data: { whatsapp_push_name: pushName } as any,
        });
      }

      // Apenas atualizar conversa ABERTA existente — NÃO reabrir fechadas, NÃO criar novas
      const conv = await this.prisma.conversation.findFirst({
        where: {
          lead_id: existingLead.id,
          channel: 'whatsapp',
          status: 'ABERTO',
        },
      });

      if (!conv) continue; // Sem conversa aberta → pular (não criar/reabrir)

      // Atualizar metadados da conversa existente (inbox, instance)
      const updateData: any = {};
      if (inboxId && !conv.inbox_id) updateData.inbox_id = inboxId;
      if (instanceName) updateData.instance_name = instanceName;
      if (inbox?.tenant_id && !conv.tenant_id) updateData.tenant_id = inbox.tenant_id;

      if (Object.keys(updateData).length > 0) {
        await this.prisma.conversation.update({
          where: { id: conv.id },
          data: updateData,
        });
      }

      // Sync last message ONLY if conversation already existed (no creation/reopen)
      if (data.lastMessage) {
        const lm = data.lastMessage;
        const msgId = lm.key?.id || lm.id;
        const msgText = lm.message?.conversation ||
                        lm.message?.extendedTextMessage?.text ||
                        lm.message?.imageMessage?.caption ||
                        (lm.messageType !== 'conversation' ? `[${lm.messageType}]` : '');

        if (msgId && msgText) {
          // Upsert da mensagem — apenas se é mais recente que a última
          const msgTimestamp = lm.messageTimestamp ? new Date(lm.messageTimestamp * 1000) : null;
          await this.prisma.message.upsert({
            where: { external_message_id: msgId },
            update: {
              status: lm.status || 'recebido',
            },
            create: {
              conversation_id: conv.id,
              direction: lm.key?.fromMe ? 'out' : 'in',
              type: 'text',
              text: msgText,
              external_message_id: msgId,
              status: lm.status || 'recebido',
              created_at: msgTimestamp || new Date(),
            },
          });

          // Atualizar last_message_at APENAS se o timestamp da mensagem é mais recente
          // que o current — evita bagunçar a ordenação com mensagens antigas
          if (msgTimestamp && conv.last_message_at && msgTimestamp > conv.last_message_at) {
            await this.prisma.conversation.update({
              where: { id: conv.id },
              data: { last_message_at: msgTimestamp },
            });
          }
        }
      }
    }
  }

  // ─── chats.delete ────────────────────────────────────────────
  // Quando o contato deleta o chat no WhatsApp, arquivamos a conversa no CRM
  // (status FECHADO) para não poluir o inbox. As mensagens são preservadas.
  async handleChatsDelete(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] chats.delete received`);
    const data = payload?.data;
    const chats = Array.isArray(data) ? data : [data];

    // Resolve o tenant da instancia que disparou o webhook — pra isolar a
    // busca por phone (bug 2026-04-29: o mesmo telefone em outro tenant
    // tava sendo "fechado" indevidamente).
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] chats.delete de instancia nao registrada "${instanceName}" — descartado`);
      return;
    }
    const tenantId = inbox?.tenant_id ?? null;

    for (const chat of chats) {
      if (!chat) continue;
      const remoteJid = chat.remoteJid || chat.id;
      if (!remoteJid || remoteJid.includes('@g.us')) continue;

      const phone = extractPhone(remoteJid, chat.remoteJidAlt);
      if (!phone || phone.length > MAX_PHONE_DIGITS) continue;

      const lead = await this.prisma.lead.findFirst({
        where: { phone, ...(tenantId ? { tenant_id: tenantId } : {}) },
      });
      if (!lead) continue;

      // Fechar apenas conversas abertas — não alterar conversas já fechadas/adiadas
      const updated = await this.prisma.conversation.updateMany({
        where: { lead_id: lead.id, channel: 'whatsapp', status: 'ABERTO' },
        data: { status: 'FECHADO' },
      });

      if (updated.count > 0) {
        this.chatGateway.emitConversationsUpdate(lead.tenant_id ?? null, true);
        this.logger.log(`[WEBHOOK] chats.delete: ${updated.count} conversa(s) de ${phone} arquivadas`);
      }
    }
  }

  async handleMessagesUpdate(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] messages.update received`);

    // Rejeita webhooks de instancia nao registrada — defesa contra Evolution
    // server compartilhado mandando status update de outro escritorio pra ca.
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] messages.update de instancia nao registrada "${instanceName}" — descartado`);
      return;
    }

    const updates = Array.isArray(payload?.data) ? payload.data : [payload?.data];

    for (const update of updates) {
      if (!update) continue;
      const externalMessageId: string = update.key?.id || update.id;
      if (!externalMessageId) continue;

      // Map Evolution status codes to internal status
      // 0=ERROR, 1=PENDING, 2=SERVER_ACK(enviado), 3=DELIVERY_ACK(entregue), 4=READ(lido), 5=PLAYED(ouvido)
      const statusCode: number = update.update?.status ?? update.status ?? -1;
      let newStatus: string | null = null;
      if (statusCode === 2) newStatus = 'enviado';
      else if (statusCode === 3) newStatus = 'entregue';
      else if (statusCode === 4 || statusCode === 5) newStatus = 'lido';

      if (!newStatus) continue;

      try {
        // Bug fix 2026-05-10 (Webhooks PR2 #11): valida que message pertence
        // ao mesmo tenant da inbox que recebeu o webhook. Antes findUnique
        // global por external_message_id podia bater em mensagem de outro
        // tenant (Lexcon e lustosa convivem na mesma Evolution — IDs sao
        // gerados pelo WhatsApp/Baileys, podem coincidir em formato). Status
        // "lido" do cliente do Lexcon atualizava mensagem do lustosa.
        const msg = await this.prisma.message.findUnique({
          where: { external_message_id: externalMessageId },
          include: { conversation: { select: { tenant_id: true } } },
        });
        if (!msg) continue;

        // Tenant cross check: se inbox tem tenant_id E msg tem tenant_id E
        // sao diferentes, descarta com log warn pra investigacao.
        const msgTenantId = msg.conversation?.tenant_id;
        if (inbox.tenant_id && msgTenantId && msgTenantId !== inbox.tenant_id) {
          this.logger.warn(
            `[WEBHOOK-TENANT-CROSS] messages.update ${externalMessageId}: ` +
            `inbox tenant=${inbox.tenant_id}, message tenant=${msgTenantId} — descartado`,
          );
          continue;
        }

        const updated = await this.prisma.message.update({
          where: { id: msg.id },
          data: { status: newStatus },
          include: { media: true, skill: { select: { id: true, name: true, area: true } } },
        });

        this.chatGateway.emitMessageUpdate(msg.conversation_id, updated);
        this.logger.log(`[WEBHOOK] msg ${externalMessageId} status → ${newStatus}`);
      } catch (e: any) {
        // Bug fix 2026-05-10 (Webhooks PR3 #20): distinguir erros esperados
        // vs inesperados. Antes try/catch generico engolia P2002 (race),
        // P2025 (msg deletada entre find e update), e tambem DB indisponivel
        // — todos como "warn". Resultado: tick azul sumindo silenciosamente
        // sem alarme. Agora classificamos:
        //   - P2025 (record not found): debug, msg foi deletada entre
        //     find/update — sem impacto
        //   - P2002 (unique violation): warn, race rara
        //   - Outros (DB down, network): error com stack pra alarme
        if (e?.code === 'P2025') {
          this.logger.debug(`[WEBHOOK] msg ${externalMessageId} deletada entre find/update — skip`);
        } else if (e?.code === 'P2002') {
          this.logger.warn(`[WEBHOOK] Race em update de ${externalMessageId} (P2002): ${e.message}`);
        } else {
          this.logger.error(
            `[WEBHOOK] Erro inesperado em update de ${externalMessageId} (${e?.code || 'unknown'}): ${e.message}`,
            e?.stack,
          );
        }
      }
    }
  }

  async handleContactsUpsert(payload: EvolutionWebhookPayload) {
    this.logger.debug(`Recebendo webhook de contatos: ${summarizePayload(payload)}`);
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] contacts.upsert de instancia nao registrada "${instanceName}" — descartado`);
      return;
    }
    const tenantId = inbox?.tenant_id ?? null;
    const contacts = Array.isArray(payload?.data)
      ? (payload.data as any[])
      : [payload?.data as any];

    // ─── Proteção anti-flood na reconexão ──────────────────────────
    // Após reconectar, a Evolution API envia contacts.upsert para TODOS os
    // contatos do WhatsApp (1000+), criando leads fantasma para números antigos.
    // Solução: contacts.upsert NUNCA cria leads novos — apenas atualiza
    // leads existentes (nome e foto). Leads são criados APENAS via
    // messages.upsert (quando chega uma mensagem real).
    // ────────────────────────────────────────────────────────────────
    //
    // Bug fix 2026-05-10 (Webhooks PR3 #23): chunks + yield event loop.
    // Mesmo padrao de chats.upsert (PR2 #8). Em rajada de 1000+ contatos
    // no reconnect, sem yield bloqueia event loop. Cache de fetchProfilePicture
    // (PR2 #13) ja reduz HTTPs, mas DB queries (findByPhone + lead.update)
    // ainda sao sequenciais — chunks evitam que outros webhooks fiquem
    // enfileirados.
    const CONTACTS_CHUNK_SIZE = 25;
    if (contacts.length > 100) {
      this.logger.log(`[contacts.upsert] Processando ${contacts.length} contatos em chunks de ${CONTACTS_CHUNK_SIZE}`);
    }

    for (let i = 0; i < contacts.length; i++) {
      if (i > 0 && i % CONTACTS_CHUNK_SIZE === 0) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const data = contacts[i];
      if (!data) continue;

      const remoteJid = (data.id as string) || (data.remoteJid as string);
      if (!remoteJid || remoteJid.includes('@g.us')) continue;

      const phone = extractPhone(remoteJid, (data.remoteJidAlt as string) || (data.remoteJid as string));
      if (phone.length > MAX_PHONE_DIGITS) continue; // LID, não é telefone real

      // Apenas atualizar leads existentes — NÃO criar novos via contacts.upsert.
      // Filtra por tenant pra nao atualizar lead de outro escritorio (bug 2026-04-29).
      const existingContact = await this.leadsService.findByPhone(phone, tenantId);
      if (!existingContact) continue;

      const updates: Record<string, string> = {};

      // pushName/verifiedName vao pra `whatsapp_push_name` (referencia do
      // operador, nao usado pela IA). `Lead.name` so eh tocado por fonte
      // confiavel (formulario, SDR coletando, manual).
      const newPushName =
        (data.pushName as string) ||
        (data.name as string) ||
        (data.verifiedName as string) ||
        null;
      if (newPushName && newPushName !== (existingContact as any).whatsapp_push_name) {
        updates.whatsapp_push_name = newPushName;
      }

      // Buscar foto se o lead não tem
      if (instanceName && !existingContact.profile_picture_url) {
        const contactPhoto = await this.whatsappService.fetchProfilePicture(instanceName, phone).catch(() => null);
        if (contactPhoto) {
          updates.profile_picture_url = contactPhoto;
        }
      }

      if (Object.keys(updates).length === 0) continue;

      await this.prisma.lead.update({
        where: { id: existingContact.id },
        data: updates,
      });

      this.logger.log(`Contato sincronizado via webhook: ${phone} (${updates.name ? updates.name : 'nome preservado'})${updates.profile_picture_url ? ' + foto' : ''}`);
    }
  }

  // ─── messages.delete ──────────────────────────────────────────

  async handleMessagesDelete(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] messages.delete received`);

    // Rejeita webhooks de instancia nao registrada
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] messages.delete de instancia nao registrada "${instanceName}" — descartado`);
      return;
    }

    const data = payload?.data;
    // Evolution v2: { key: { remoteJid, fromMe, id }, ... } or data directly
    const messageKey = data?.key || data;
    const externalId = messageKey?.id;
    if (!externalId) return;

    const msg = await this.prisma.message.findUnique({
      where: { external_message_id: externalId },
    });
    if (!msg) return;

    // Preserva conteúdo original (texto, tipo, mídia) para uso como prova.
    // Apenas marca o status — não altera type nem text.
    const updated = await this.prisma.message.update({
      where: { id: msg.id },
      data: { status: 'apagado_pelo_contato' },
      include: { media: true, skill: { select: { id: true, name: true, area: true } } },
    });

    // Emite messageUpdate — frontend ja escuta e atualiza
    this.chatGateway.emitMessageUpdate(msg.conversation_id, updated);

    this.logger.log(`[WEBHOOK] Message ${msg.id} marked as deleted by contact (content preserved)`);
  }

  // ─── contacts.update ──────────────────────────────────────────

  async handleContactsUpdate(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] contacts.update received`);
    const data = payload?.data;
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] contacts.update de instancia nao registrada "${instanceName}" — descartado`);
      return;
    }
    const tenantId = inbox?.tenant_id ?? null;
    const contacts = Array.isArray(data) ? data : [data];

    for (const contact of contacts) {
      if (!contact) continue;
      const jid = contact.id || contact.jid || contact.remoteJid;
      if (!jid) continue;

      const phone = jid.replace(/@.*$/, '');
      if (!phone || phone.includes('-')) continue; // Ignorar grupos
      if (phone.length > MAX_PHONE_DIGITS) continue; // LID, não é telefone real

      // Filtra por tenant pra evitar atualizar lead de outro escritorio com
      // o mesmo telefone (bug 2026-04-29).
      const lead = await this.prisma.lead.findFirst({
        where: { phone, ...(tenantId ? { tenant_id: tenantId } : {}) },
      });
      if (!lead) continue;

      const updates: Record<string, string> = {};

      // pushName do contacts.update vai pra `whatsapp_push_name` (referencia
      // do operador, nunca usado pela IA). `Lead.name` so eh preenchido por
      // fonte confiavel (formulario do site, SDR coletando, cadastro manual).
      const newPushName = contact.pushName || contact.name || contact.verifiedName;
      if (newPushName && newPushName !== (lead as any).whatsapp_push_name) {
        updates.whatsapp_push_name = newPushName;
      }

      // Buscar nova foto de perfil — URLs do WhatsApp expiram, sempre atualizar com URL fresca
      if (instanceName) {
        try {
          const newPic = await this.whatsappService.fetchProfilePicture(instanceName, phone);
          if (newPic) {
            updates.profile_picture_url = newPic;
          }
        } catch {
          // Best-effort — ignorar falha ao buscar foto
        }
      }

      if (Object.keys(updates).length === 0) continue;

      await this.prisma.lead.update({
        where: { id: lead.id },
        data: updates,
      });

      this.chatGateway.emitConversationsUpdate(lead.tenant_id ?? null);
      this.logger.log(`[WEBHOOK] Lead ${lead.id} updated: ${JSON.stringify(updates)}`);
    }
  }

  // ─── connection.update ──────────────────────────────────────────

  async handleConnectionUpdate(payload: EvolutionWebhookPayload) {
    this.logger.log(`[WEBHOOK] connection.update received`);
    const data = payload?.data;
    const instanceName = payload?.instance || payload?.instanceId;
    const state = data?.state || data?.status || 'unknown';

    // Rejeita connection.update de instancia nao registrada — Evolution
    // server compartilhado nao deve manchar dashboard de outro escritorio.
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] connection.update de instancia nao registrada "${instanceName}" (state=${state}) — descartado`);
      return;
    }

    this.chatGateway.emitConnectionStatusUpdate({
      instanceName: instanceName || 'unknown',
      state,
      statusReason: data?.statusReason,
    });

    this.logger.log(`[WEBHOOK] Instance ${instanceName} connection: ${state}`);

    // Quando a instância reconecta, agenda resync das mensagens perdidas durante a queda.
    // Limitamos às 50 conversas mais recentes para não sobrecarregar.
    if (state === 'open' && instanceName) {
      this.logger.log(`[RESYNC] Instância ${instanceName} reconectou — agendando resync de mensagens`);
      this.scheduleResyncAfterReconnect(instanceName, { triggerReason: 'webhook' }).catch(e =>
        this.logger.warn(`[RESYNC] Erro ao agendar resync: ${e.message}`),
      );
    }
  }

  /**
   * Dispara o resync de mensagens perdidas para uma instância.
   *
   * Fluxo em 2 fases:
   *  - Fase 1: busca chats recentes via Evolution `findChats` e cria
   *    leads/conversas para os que não existem no CRM (mensagens chegadas
   *    com o servidor fora do ar → novas conversas).
   *  - Fase 2: enfileira um job `sync_missed_messages` por conversa aberta
   *    para reimportar o histórico via `findMessages` (dedup por
   *    `external_message_id`).
   *
   * Triggers:
   *  - `webhook`   → evento `connection.update` state=open (WhatsApp reconectou)
   *  - `startup`   → subida do servidor (cobre quando o CRM caiu mas a Evolution ficou de pé)
   *  - `cron`      → rede de segurança a cada 15 min
   *  - `manual`    → endpoint administrativo `/whatsapp/instances/:name/resync`
   */
  async scheduleResyncAfterReconnect(
    instanceName: string,
    options: {
      cutoffHours?: number;
      stabilizeDelayMs?: number;
      triggerReason?: 'webhook' | 'startup' | 'cron' | 'manual';
    } = {},
  ): Promise<{ newConvsCreated: number; conversationsResynced: number }> {
    const cutoffHours = options.cutoffHours ?? 72;
    const STABILIZE_DELAY = options.stabilizeDelayMs ?? 10000;
    const reason = options.triggerReason ?? 'webhook';

    // Bug fix 2026-05-10 (Webhooks PR2 #10): singleton lock por instanceName.
    // Antes cron a cada 15min + connection.update + manual + startup podiam
    // disparar 4-5 syncs simultaneos da MESMA instancia — cada um criando
    // setTimeout(STABILIZE_DELAY) que disparava em paralelo, saturando
    // pool DB + rate limit Evolution. Agora se ja tem sync rodando pra
    // essa instancia, retorna early com log warn (re-tentativa cai no
    // proximo cron de 15min).
    if (this.activeResyncs.has(instanceName)) {
      this.logger.warn(
        `[RESYNC] LOCK: ja existe resync ativo pra ${instanceName} (trigger=${reason}) — skip pra evitar duplicacao`,
      );
      return { newConvsCreated: 0, conversationsResynced: 0 };
    }
    this.activeResyncs.add(instanceName);

    // Defesa: se a funcao throw inesperado (FASE 1 ou 2 nao tratado),
    // garante que o lock seja liberado pra nao prender a instancia ate
    // restart. setTimeout da FASE 2 tambem libera no proprio finally.
    let setTimeoutScheduled = false;
    try {

    this.logger.log(
      `[RESYNC] Iniciando resync para ${instanceName} (trigger=${reason}, cutoff=${cutoffHours}h, stabilize=${STABILIZE_DELAY}ms)`,
    );

    let newConvsCreated = 0;

    // ─── FASE 1: Descobrir chats novos via Evolution API ──────────────
    // Busca chats recentes do WhatsApp e cria leads/conversas para os que
    // NÃO existem no CRM (mensagens que chegaram durante a queda do servidor).
    //
    // CRITICAL: Bug 2026-04-28 — fetchChats sem limite + loop iterando 10.900
    // chats com 2 queries cada saturava event loop por 50-100s, causando
    // ping timeout no Socket.IO e SIGKILL pelo Swarm. Fixes:
    //   1) maxPages=2 (em vez de 20) e cutoffTs no fetchChats — limita HTTP
    //   2) Pre-filtro CPU-only por cutoff/jid/phone ANTES de qualquer DB query
    //   3) Hard cap de 200 chats consultam DB
    //   4) Yield event loop a cada 25 iteracoes pra Socket.IO heartbeat passar
    try {
      const cutoffTs = Date.now() - cutoffHours * 3600 * 1000;
      const recentChats = await this.whatsappService.fetchChats(instanceName, {
        maxPages: 2, // ~1100 chats max em vez de 10.900
        cutoffTs,    // para paginacao ainda mais cedo
      });
      const inbox = await this.inboxesService.findByInstanceName(instanceName);
      const inboxId = inbox?.inbox_id || null;
      const tenantId = inbox?.tenant_id || null;

      // Pre-filtro CPU-only: descarta chats antes de tocar no DB.
      // Reduz drasticamente o numero de iteracoes que fazem await Prisma.
      const candidates = recentChats.filter((chat: any) => {
        if (!chat) return false;
        const remoteJid = (chat.remoteJidAlt || chat.remoteJid) as string;
        if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('status@')) return false;
        const lastMsgTs = chat.lastMessage?.messageTimestamp ? Number(chat.lastMessage.messageTimestamp) * 1000 : 0;
        if (lastMsgTs > 0 && lastMsgTs < cutoffTs) return false;
        return true;
      });

      // Hard cap: nunca consulta DB pra mais que MAX_DB_LOOKUPS chats. Mesmo
      // com pre-filtro, se tiver 5000 chats sem timestamp valido, ainda da
      // ruim. 200 cobre 99% dos casos reais.
      const MAX_DB_LOOKUPS = 200;
      const toProcess = candidates.slice(0, MAX_DB_LOOKUPS);
      if (candidates.length > MAX_DB_LOOKUPS) {
        this.logger.warn(`[RESYNC] FASE 1: ${candidates.length} candidatos, processando apenas ${MAX_DB_LOOKUPS} mais recentes`);
      } else {
        this.logger.log(`[RESYNC] FASE 1: ${recentChats.length} chats fetched, ${candidates.length} candidatos pos-filtro`);
      }

      // Paralelismo controlado: chunks de 5 em vez de 1 por vez. Throughput
      // 5x melhor que sequencial puro, mas nao satura pool (limite eh 25).
      // Yield event loop entre chunks pra Socket.IO heartbeat passar.
      const CHUNK_SIZE = 5;
      for (let idx = 0; idx < toProcess.length; idx += CHUNK_SIZE) {
        const chunk = toProcess.slice(idx, idx + CHUNK_SIZE);
        await Promise.all(chunk.map(async (chat: any) => {
          const phone = extractPhone(chat.remoteJid as string, chat.remoteJidAlt as string);
          if (!phone || phone.length > MAX_PHONE_DIGITS || phone.length < 10) return;

          const lastMsgTs = chat.lastMessage?.messageTimestamp
            ? Number(chat.lastMessage.messageTimestamp) * 1000
            : 0;
          const remoteJid = (chat.remoteJidAlt || chat.remoteJid) as string;

          // Verificar se já existe conversa ABERTA para este lead.
          // Filtra por tenant pra nao tocar em lead de outro escritorio
          // (bug 2026-04-29).
          const existingLead = await this.leadsService.findByPhone(phone, tenantId);
          if (existingLead) {
            const existingConv = await this.prisma.conversation.findFirst({
              where: { lead_id: existingLead.id, channel: 'whatsapp', status: { in: ['ABERTO', 'ADIADO'] } },
            });
            if (existingConv) return; // Já existe conversa ativa → será sincronizada na fase 2
          }

          // Chat recente sem conversa no CRM → criar lead + conversa.
          // pushName vai pra whatsapp_push_name (referencia, nao usado pela IA).
          const pushName = (chat.pushName as string) || (chat.name as string) || null;
          if (!existingLead && !pushName) return; // Sem lead e sem pushName → ignorar (nao da pra criar lead)

          const lead = await this.leadsService.upsert(
            {
              phone,
              ...(pushName ? { whatsapp_push_name: pushName } : {}),
              ...(chat.profilePicUrl ? { profile_picture_url: chat.profilePicUrl as string } : {}),
              origin: 'whatsapp',
              ...(tenantId ? { tenant: { connect: { id: tenantId } } } : {}),
            } as any,
            inboxId, // isola notificacao de lead novo ao inbox do setor (resync pos-reconexao)
          );

          // Reabrir conversa fechada ou criar nova
          let conv = await this.prisma.conversation.findFirst({
            where: { lead_id: lead.id, channel: 'whatsapp', status: 'FECHADO' },
            orderBy: { last_message_at: 'desc' },
          });

          if (conv) {
            conv = await this.prisma.conversation.update({
              where: { id: conv.id },
              data: {
                status: 'ABERTO',
                last_message_at: lastMsgTs ? new Date(lastMsgTs) : new Date(),
                instance_name: instanceName,
                ...(inboxId && !conv.inbox_id ? { inbox_id: inboxId } : {}),
              },
            });
          } else {
            conv = await this.prisma.conversation.create({
              data: {
                lead_id: lead.id,
                channel: 'whatsapp',
                status: 'ABERTO',
                external_id: remoteJid,
                inbox_id: inboxId,
                instance_name: instanceName,
                tenant_id: tenantId,
                last_message_at: lastMsgTs ? new Date(lastMsgTs) : new Date(),
              },
            });
          }

          newConvsCreated++;
          this.logger.log(`[RESYNC] Nova conversa criada para ${phone} (mensagem durante a queda)`);
        }));
        // Yield event loop entre chunks
        await new Promise((r) => setImmediate(r));
      }

      if (newConvsCreated > 0) {
        this.logger.log(`[RESYNC] ${newConvsCreated} conversas novas criadas de chats recentes do WhatsApp`);
        this.chatGateway.emitConversationsUpdate(tenantId, true);
      }
    } catch (e: any) {
      this.logger.warn(`[RESYNC] Erro ao buscar chats recentes: ${e.message}`);
    }

    // ─── FASE 2: Sincronizar mensagens perdidas das conversas abertas ─
    const conversations = await this.prisma.conversation.findMany({
      where: { instance_name: instanceName, status: { in: ['ABERTO', 'ADIADO'] } },
      include: { lead: { select: { phone: true } } },
      orderBy: { last_message_at: 'desc' },
      take: 100, // Aumentado de 50 para 100
    });

    this.logger.log(
      `[RESYNC] ${conversations.length} conversas ativas para resync na instância ${instanceName} (trigger=${reason})`,
    );

    // CRITICAL: Bug 2026-04-28 — antes enfileirava 100 jobs `sync_missed_messages`
    // na queue media-jobs, mas NAO HAVIA WORKER consumindo. Resultado: jobs
    // vazavam no Redis indefinidamente (cron a cada 15min empilhava +100/run).
    // Fix: chamada direta ao messagesService.syncHistoryFromWhatsApp em background
    // com paralelismo controlado (3 conversas por vez), apos STABILIZE_DELAY.
    const conversationsToSync = conversations.filter((c) => !!c.lead?.phone);
    if (conversationsToSync.length > 0) {
      setTimeoutScheduled = true; // marca que o setTimeout vai liberar o lock
      // Roda em background — webhook responde rapido, sync acontece off-thread.
      setTimeout(async () => {
        try {
          // moduleRef.get pra resolver MessagesService em runtime sem injetar
          // direto (mantem opcional, se faltar so loga warning).
          const messagesService = this.moduleRef.get(MessagesService, { strict: false });
          if (!messagesService) {
            this.logger.warn('[RESYNC] FASE 2: MessagesService nao disponivel — skip');
            return;
          }

          this.logger.log(`[RESYNC] FASE 2 iniciando sync inline de ${conversationsToSync.length} conversas (3 paralelas)`);

          const PARALLEL_SYNC = 3;
          let synced = 0;
          for (let idx = 0; idx < conversationsToSync.length; idx += PARALLEL_SYNC) {
            const chunk = conversationsToSync.slice(idx, idx + PARALLEL_SYNC);
            await Promise.all(chunk.map(async (conv) => {
              try {
                await messagesService.syncHistoryFromWhatsApp(conv.id);
                synced++;
              } catch (e: any) {
                this.logger.warn(`[RESYNC] FASE 2 falha sync conv ${conv.id}: ${e.message}`);
              }
            }));
            // Yield event loop entre chunks pra Socket.IO continuar respondendo
            await new Promise((r) => setImmediate(r));
          }

          this.logger.log(`[RESYNC] FASE 2 concluida: ${synced}/${conversationsToSync.length} conversas sincronizadas`);
        } catch (e: any) {
          this.logger.error(`[RESYNC] FASE 2 erro inesperado: ${e.message}`);
        } finally {
          // Bug fix 2026-05-10 (PR2 #10): libera lock APOS FASE 2 terminar.
          // Importante estar no finally pra garantir liberacao mesmo se a
          // sync explodir — senao a instancia fica "presa" ate restart.
          this.activeResyncs.delete(instanceName);
          this.logger.log(`[RESYNC] LOCK liberado pra ${instanceName}`);
        }
      }, STABILIZE_DELAY);
    }

    return { newConvsCreated, conversationsResynced: conversationsToSync.length };

    } finally {
      // Se setTimeout foi schedulado, ele vai liberar o lock no proprio
      // finally interno. Se nao foi (sem conversas, ou throw), libera aqui.
      if (!setTimeoutScheduled) {
        this.activeResyncs.delete(instanceName);
      }
    }
  }

  // ─── onApplicationBootstrap ─────────────────────────────────────
  // Executado uma vez quando o servidor sobe. Dispara o resync para cada
  // instância cadastrada, cobrindo o cenário em que o CRM caiu enquanto a
  // Evolution API continuou rodando: nesse caso o webhook `connection.update`
  // NUNCA é disparado (do ponto de vista da Evolution, nada mudou), então
  // o único jeito de recuperar as mensagens é o próprio CRM disparar o sync
  // ao voltar do ar.

  async onApplicationBootstrap(): Promise<void> {
    // Delay de 30s para garantir que Redis/Prisma/BullMQ estejam 100% prontos
    // e dar tempo da Evolution API reentregar webhooks que estavam em retry.
    // Bug 2026-04-28: 20s era curto demais — Socket.IO ainda nao estava
    // estavel quando resync comecava e travava event loop por ~60s.
    const BOOT_DELAY = 30000;

    this.logger.log(`[BOOT] Resync de startup agendado para daqui a ${BOOT_DELAY / 1000}s`);

    setTimeout(async () => {
      try {
        const instances = await this.prisma.instance.findMany({
          where: { type: 'whatsapp' },
          select: { name: true },
        });

        if (!instances.length) {
          this.logger.log('[BOOT] Nenhuma instância de WhatsApp cadastrada — skip');
          return;
        }

        this.logger.log(
          `[BOOT] Disparando resync de startup para ${instances.length} instância(s): ${instances.map(i => i.name).join(', ')}`,
        );

        for (const inst of instances) {
          try {
            const result = await this.scheduleResyncAfterReconnect(inst.name, {
              cutoffHours: 24, // recupera mensagens das últimas 24h
              stabilizeDelayMs: 5000, // já esperamos 20s de boot, 5s extras por job bastam
              triggerReason: 'startup',
            });
            this.logger.log(
              `[BOOT] ${inst.name}: ${result.newConvsCreated} conversa(s) nova(s), ` +
                `${result.conversationsResynced} conversa(s) enfileirada(s) para resync`,
            );
          } catch (e: any) {
            this.logger.warn(`[BOOT] Resync falhou para ${inst.name}: ${e.message}`);
          }
        }
      } catch (e: any) {
        this.logger.error(`[BOOT] Erro no hook de startup: ${e.message}`);
      }
    }, BOOT_DELAY);
  }

  // ─── Cron de rede de segurança ──────────────────────────────────
  // A cada 15 minutos faz um resync leve (cutoff 2h) de todas as instâncias.
  // Protege contra webhooks que falharam silenciosamente: timeout de rede,
  // instabilidade da Evolution API, reinicialização do Redis, etc.
  // É idempotente — a UNIQUE em `external_message_id` garante que mensagens
  // já importadas são descartadas via `findUnique` antes de qualquer insert.

  @Cron('*/15 * * * *', { name: 'evolution-resync-safety-net' })
  async resyncPeriodicSafetyNet(): Promise<void> {
    await this.cronRunner.run(
      'evolution-resync-safety-net',
      10 * 60,
      async () => {
        const instances = await this.prisma.instance.findMany({
          where: { type: 'whatsapp' },
          select: { name: true },
        });

        if (!instances.length) return;

        this.logger.log(`[CRON] Resync de segurança para ${instances.length} instância(s)`);

        for (const inst of instances) {
          try {
            await this.scheduleResyncAfterReconnect(inst.name, {
              cutoffHours: 2, // janela curta — última fatia
              stabilizeDelayMs: 0,
              triggerReason: 'cron',
            });
          } catch (e: any) {
            this.logger.warn(`[CRON] Resync falhou para ${inst.name}: ${e.message}`);
          }
        }
      },
      { description: 'Resync de seguranca (cutoff 2h) das instancias WhatsApp — webhook fallback', schedule: '*/15 * * * *' },
    );
  }

  // ─── presence.update ──────────────────────────────────────────

  // Bug fix 2026-05-10 (Webhooks PR3 #25): cache (jid -> {tenantId, leadId,
  // conversationId, expiresAt}). WhatsApp envia presence dezenas de vezes
  // por segundo durante "digitando" — antes cada uma fazia 3 queries
  // (inbox + lead + conversation). Cache TTL 60s mata 90% das queries
  // sem perder reactivity (operador raramente abre/fecha conversa em <60s).
  // Cap 5k entradas (LRU). Cache miss/expirado ainda faz queries normais
  // e re-popula.
  private readonly presenceResolveCache = new Map<string, {
    conversationId: string | null;
    expiresAt: number;
  }>();

  async handlePresenceUpdate(payload: EvolutionWebhookPayload) {
    this.logger.debug(`[WEBHOOK] presence.update received`); // log debug, eh evento de alta freq
    const data = payload?.data;
    const jid = data?.id || data?.remoteJid;
    if (!jid) return;

    const phone = jid.replace(/@.*$/, '');
    if (!phone || phone.includes('-')) return; // Ignorar grupos

    // Isola por tenant — antes a presenca de um lead em outro escritorio
    // com o mesmo telefone podia disparar evento na conversa errada (bug
    // 2026-04-29).
    const instanceName = payload?.instance || payload?.instanceId;
    const inbox = instanceName ? await this.inboxesService.findByInstanceName(instanceName) : null;
    if (!inbox) {
      this.logger.warn(`[WEBHOOK-REJECT] presence.update de instancia nao registrada "${instanceName}" — descartado`);
      return;
    }
    const tenantId = inbox?.tenant_id ?? null;

    // Cache lookup: chave (instance:jid) — pra isolar entre instancias de
    // tenants diferentes que poderiam ter o mesmo telefone.
    const cacheKey = `${instanceName}:${jid}`;
    const cached = this.presenceResolveCache.get(cacheKey);
    let conversationId: string | null;
    if (cached && cached.expiresAt > Date.now()) {
      conversationId = cached.conversationId;
    } else {
      if (cached) this.presenceResolveCache.delete(cacheKey);

      const lead = await this.prisma.lead.findFirst({
        where: { phone, ...(tenantId ? { tenant_id: tenantId } : {}) },
      });
      if (!lead) {
        // Cacheia null tambem (lead nao existe — proxima presence skip)
        this.presenceResolveCache.set(cacheKey, { conversationId: null, expiresAt: Date.now() + 60_000 });
        this.trimPresenceCache();
        return;
      }

      const conversation = await this.prisma.conversation.findFirst({
        where: { lead_id: lead.id, status: { in: ['ABERTO', 'ADIADO'] } },
        orderBy: { last_message_at: 'desc' },
      });
      conversationId = conversation?.id ?? null;
      this.presenceResolveCache.set(cacheKey, { conversationId, expiresAt: Date.now() + 60_000 });
      this.trimPresenceCache();
    }

    if (!conversationId) return;

    // Extrair presence do payload
    const presences = data?.presences || {};
    const presenceData = Object.values(presences)[0] as any;
    const presence = presenceData?.lastKnownPresence || data?.presence || 'unavailable';

    this.chatGateway.emitContactPresence(conversationId, {
      presence,
      lastSeen: presence === 'unavailable' ? new Date().toISOString() : undefined,
    });
  }

  private trimPresenceCache(): void {
    const MAX = 5_000;
    if (this.presenceResolveCache.size <= MAX) return;
    const toRemove = this.presenceResolveCache.size - MAX + 500;
    let removed = 0;
    for (const key of this.presenceResolveCache.keys()) {
      if (removed >= toRemove) break;
      this.presenceResolveCache.delete(key);
      removed++;
    }
  }
}
