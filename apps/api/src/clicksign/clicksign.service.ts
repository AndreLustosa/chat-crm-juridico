import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { ContractsService, ContratoVariaveis } from '../contracts/contracts.service';
import { SettingsService } from '../settings/settings.service';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface ClicksignDocument {
  key: string;
  path: string;
  status: string;
  [k: string]: unknown;
}

interface ClicksignSigner {
  key: string;
  [k: string]: unknown;
}

interface ClicksignList {
  document_key: string;
  signer_key: string;
  request_signature_key: string;
  [k: string]: unknown;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ClicksignService {
  private readonly logger = new Logger(ClicksignService.name);
  private readonly publicApiUrl: string;

  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
    private whatsapp: WhatsappService,
    private chatGateway: ChatGateway,
    private contracts: ContractsService,
    private settings: SettingsService,
  ) {
    this.publicApiUrl = process.env.PUBLIC_API_URL ?? '';
  }

  // ── Obtém configuração do DB (com fallback para env vars) ──────────────────

  private async getCfg() {
    const cfg = await this.settings.getClicksignConfig();
    return {
      baseUrl: cfg.baseUrl.replace(/\/$/, ''),
      token: cfg.apiToken,
      webhookToken: cfg.webhookToken,
    };
  }

  // ── Utilitário: faz chamadas HTTP para a API Clicksign ─────────────────────

  private async clicksignFetch<T>(
    method: string,
    path: string,
    body?: object,
  ): Promise<T> {
    const { baseUrl, token } = await this.getCfg();
    const url = `${baseUrl}/api/v1${path}?access_token=${token}`;
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };

    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Clicksign API ${method} ${path} → ${res.status}: ${text}`,
      );
    }

    // 204 No Content (ex.: download redireciona) — retornar objeto vazio
    if (res.status === 204) return {} as T;

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) return res.json() as Promise<T>;

    // Download binário — retornar o Buffer no campo "buffer"
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer) } as unknown as T;
  }

  // ── Passo 1: upload do DOCX ────────────────────────────────────────────────

  private async uploadDocument(
    buffer: Buffer,
    filename: string,
  ): Promise<string> {
    const base64 = buffer.toString('base64');
    const ext = filename.endsWith('.pdf') ? 'pdf' : 'docx';
    const mimeType =
      ext === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    const payload = {
      document: {
        path: `/${filename}`,
        content_base64: `data:${mimeType};base64,${base64}`,
      },
    };

    const result = await this.clicksignFetch<{ document: ClicksignDocument }>(
      'POST',
      '/documents',
      payload,
    );
    const key = result?.document?.key;
    if (!key) throw new InternalServerErrorException('Clicksign não retornou document.key');
    this.logger.log(`[Clicksign] Documento criado: ${key}`);
    return key;
  }

  // ── Passo 2: criar signatário (WhatsApp + Selfie) ─────────────────────────

  private async createSigner(
    name: string,
    email: string,
    phone: string,
  ): Promise<string> {
    // Remove tudo que não é dígito e retira o DDI 55 do Brasil
    // Ex: +5582991301276 → 82991301276 (só DDD + número)
    let phoneNumber = phone.replace(/\D/g, '');
    if (phoneNumber.startsWith('55') && phoneNumber.length >= 12) {
      phoneNumber = phoneNumber.slice(2);
    }

    const payload = {
      signer: {
        name,
        email,
        phone_number: phoneNumber,
        auths: ['whatsapp'],   // token enviado via WhatsApp (não SMS)
        selfie_enabled: true,
        has_documentation: false,
      },
    };

    const result = await this.clicksignFetch<{ signer: ClicksignSigner }>(
      'POST',
      '/signers',
      payload,
    );
    const key = result?.signer?.key;
    if (!key) throw new InternalServerErrorException('Clicksign não retornou signer.key');
    this.logger.log(`[Clicksign] Signatário criado: ${key}`);
    return key;
  }

  // ── Passo 3: associar signatário ao documento ──────────────────────────────

  private async addSignerToDocument(
    documentKey: string,
    signerKey: string,
  ): Promise<string> {
    const payload = {
      list: {
        document_key: documentKey,
        signer_key: signerKey,
        sign_as: 'party',
        refusable: false,
        message:
          'Por favor, assine o contrato de prestação de serviços advocatícios.',
        delivery: 'link',
      },
    };

    const result = await this.clicksignFetch<{ list: ClicksignList }>(
      'POST',
      '/lists',
      payload,
    );
    const requestKey = result?.list?.request_signature_key;
    if (!requestKey)
      throw new InternalServerErrorException('Clicksign não retornou request_signature_key');
    this.logger.log(`[Clicksign] Signatário adicionado, request_key: ${requestKey}`);
    return requestKey;
  }

  // ── Método principal: solicitar assinatura ─────────────────────────────────

  async requestSignature(params: {
    conversationId: string;
    variaveis: ContratoVariaveis;
  }): Promise<{ signingUrl: string }> {
    const { conversationId, variaveis } = params;
    const { baseUrl, token } = await this.getCfg();

    if (!token)
      throw new BadRequestException('Clicksign não configurado — acesse Configurações › Contratos & Assinatura');

    // Busca dados da conversa
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
    if (!convo?.lead) throw new BadRequestException('Conversa inválida');

    const lead = convo.lead;
    const clientName = variaveis.NOME_CONTRATANTE || lead.name || 'Cliente';
    const clientPhone = lead.phone;
    const clientEmail = (lead as any).email ?? `${lead.phone.replace(/\D/g, '')}@noreply.placeholder`;
    const instanceName = convo.instance_name ?? undefined;

    // 1. Gerar buffer do documento
    const buffer = await this.contracts.generateBuffer(variaveis);
    const safeName = clientName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const filename = `Contrato_Trabalhista_${safeName}_${Date.now()}.docx`;

    // 2. Upload para Clicksign
    const documentKey = await this.uploadDocument(buffer, filename);

    // 3. Criar signatário
    const signerKey = await this.createSigner(clientName, clientEmail, clientPhone);

    // 4. Associar signatário
    const requestSignatureKey = await this.addSignerToDocument(documentKey, signerKey);

    // 5. Montar URL de assinatura
    const signingUrl = `${baseUrl}/sign/${requestSignatureKey}`;

    // 6. Persistir no banco
    const signature = await this.prisma.contractSignature.create({
      data: {
        lead_id: lead.id,
        conversation_id: conversationId,
        cs_document_key: documentKey,
        cs_signer_key: signerKey,
        cs_request_signature_key: requestSignatureKey,
        signing_url: signingUrl,
        status: 'PENDENTE',
      },
    });
    this.logger.log(`[Clicksign] ContractSignature criado: ${signature.id}`);

    // 7. Enviar URL via WhatsApp
    const msg =
      `📝 *Contrato de Honorários Advocatícios*\n\n` +
      `Olá, ${clientName.split(' ')[0]}! Seu contrato está pronto para assinatura digital.\n\n` +
      `🔒 A assinatura é segura e válida juridicamente (Lei 14.063/2020).\n` +
      `📱 Você precisará confirmar sua identidade via SMS e selfie.\n\n` +
      `✍️ *Clique aqui para assinar:*\n${signingUrl}`;

    try {
      await this.whatsapp.sendText(clientPhone, msg, instanceName);
      this.logger.log(`[Clicksign] Link enviado via WhatsApp para ${clientPhone}`);
    } catch (e: any) {
      this.logger.warn(`[Clicksign] Falha ao enviar WhatsApp: ${e.message}`);
    }

    return { signingUrl };
  }

  // ── Verificar assinatura HMAC do webhook ──────────────────────────────────

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    const { webhookToken } = await this.getCfg();
    if (!webhookToken) {
      this.logger.warn('[Clicksign] webhookToken não configurado — verificação ignorada');
      return true;
    }
    const expected = crypto
      .createHmac('sha256', webhookToken)
      .update(payload)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  // ── Mapa de eventos de erro biométrico ────────────────────────────────────

  private readonly BIOMETRIC_ERROR_EVENTS: Record<string, string> = {
    liveness_refused:             'selfie dinâmica',
    liveness_attempts_exceeded:   'selfie dinâmica (tentativas esgotadas)',
    facematch_refused:            'biometria facial',
    facematch_attempts_exceeded:  'biometria facial (tentativas esgotadas)',
    biometric_refused:            'biometria facial SERPRO',
    documentscopy_refused:        'análise do documento',
    ocr_refused:                  'leitura do documento (OCR)',
  };

  // ── Handler de erros biométricos — envia tutorial ao cliente ──────────────

  private async handleBiometricError(eventName: string, documentKey: string): Promise<void> {
    const errorType = this.BIOMETRIC_ERROR_EVENTS[eventName] ?? 'verificação';

    const sig = await this.prisma.contractSignature.findUnique({
      where: { cs_document_key: documentKey },
      include: { conversation: { include: { lead: true } } },
    });

    if (!sig?.conversation?.lead) {
      this.logger.warn(`[Clicksign][Biometria] Documento ${documentKey} não encontrado`);
      return;
    }

    const lead          = sig.conversation.lead;
    const instanceName  = sig.conversation.instance_name ?? undefined;
    const signingUrl    = sig.signing_url;

    // Atualizar status no banco
    await this.prisma.contractSignature.update({
      where: { id: sig.id },
      data:  { status: 'ERRO_BIOMETRIA' },
    });

    // Mensagem de tutorial para o cliente via WhatsApp
    const lines = [
      `⚠️ *Tivemos um problema na etapa de ${errorType}* do seu contrato.`,
      ``,
      `*Para tentar novamente, siga estas dicas:*`,
      `📱 Use o celular com câmera frontal`,
      `💡 Fique em local bem iluminado (luz natural é melhor)`,
      `👓 Retire óculos, boné ou qualquer acessório no rosto`,
      `🙂 Olhe diretamente para a câmera, rosto centralizado`,
      `🚫 Evite janelas ou luz forte atrás de você`,
      `📷 Segure o celular na altura do rosto, sem inclinação`,
      ``,
      ...(signingUrl
        ? [`✍️ *Acesse o link abaixo para assinar novamente:*\n${signingUrl}`]
        : [`Entre em contato conosco para receber um novo link de assinatura.`]),
    ];

    try {
      await this.whatsapp.sendText(lead.phone, lines.join('\n'), instanceName);
      this.logger.log(`[Clicksign][Biometria] Tutorial enviado para ${lead.phone} (${eventName})`);
    } catch (e: any) {
      this.logger.warn(`[Clicksign][Biometria] Falha ao enviar tutorial: ${e.message}`);
    }

    // Notificar atendente via WebSocket
    try {
      this.chatGateway.server
        ?.to(sig.conversation_id)
        .emit('contract:biometric_error', {
          conversationId: sig.conversation_id,
          leadName:       lead.name ?? 'Cliente',
          eventName,
          errorType,
        });
    } catch (e: any) {
      this.logger.warn(`[Clicksign][Biometria] Falha WebSocket: ${e.message}`);
    }
  }

  // ── Processar evento do webhook ───────────────────────────────────────────

  async handleWebhookEvent(payload: any): Promise<void> {
    // Clicksign envia diferentes estruturas — suportar v1 e v2
    const eventName: string =
      payload?.event?.name ?? payload?.event ?? '';
    const document =
      payload?.event?.data?.document ?? payload?.document ?? payload?.data?.document ?? {};

    const documentKey: string = document?.key ?? '';
    const documentStatus: string = document?.status ?? '';

    this.logger.log(
      `[Clicksign] Webhook recebido — event: ${eventName}, doc: ${documentKey}, status: ${documentStatus}`,
    );

    // Tratar erros biométricos antes de qualquer outra lógica
    if (this.BIOMETRIC_ERROR_EVENTS[eventName]) {
      await this.handleBiometricError(eventName, documentKey);
      return;
    }

    // Só processar quando o documento foi totalmente assinado (status "closed")
    if (documentStatus !== 'closed') {
      this.logger.debug(`[Clicksign] Status ${documentStatus} ignorado`);
      return;
    }

    // Buscar o registro no banco
    const sig = await this.prisma.contractSignature.findUnique({
      where: { cs_document_key: documentKey },
    });
    if (!sig) {
      this.logger.warn(`[Clicksign] Documento ${documentKey} não encontrado no banco`);
      return;
    }
    if (sig.status === 'ASSINADO') {
      this.logger.debug(`[Clicksign] Documento ${documentKey} já processado`);
      return;
    }

    // Buscar conversa + lead
    const convo = await this.prisma.conversation.findUnique({
      where: { id: sig.conversation_id },
      include: { lead: true },
    });
    if (!convo?.lead) {
      this.logger.warn(`[Clicksign] Conversa ${sig.conversation_id} inválida`);
      return;
    }

    const leadName = convo.lead.name ?? 'Cliente';
    const clientPhone = convo.lead.phone;
    const instanceName = convo.instance_name ?? undefined;
    const signedAt = new Date();

    // Download do PDF assinado via Clicksign
    let signedS3Key: string | undefined;
    try {
      const dlResult = await this.clicksignFetch<{ buffer?: Buffer }>(
        'GET',
        `/documents/${documentKey}/download`,
      );

      if (dlResult?.buffer && dlResult.buffer.length > 0) {
        signedS3Key = `contracts-signed/${sig.id}.pdf`;
        await this.s3.uploadBuffer(signedS3Key, dlResult.buffer, 'application/pdf');
        this.logger.log(`[Clicksign] PDF assinado salvo: ${signedS3Key}`);
      }
    } catch (e: any) {
      this.logger.warn(`[Clicksign] Falha ao baixar PDF assinado: ${e.message}`);
    }

    // Atualizar status no banco
    await this.prisma.contractSignature.update({
      where: { id: sig.id },
      data: {
        status: 'ASSINADO',
        signed_at: signedAt,
        ...(signedS3Key ? { signed_s3_key: signedS3Key } : {}),
      },
    });

    // Enviar PDF assinado ao cliente via WhatsApp (se disponível)
    if (signedS3Key && this.publicApiUrl) {
      try {
        // URL pública que serve o arquivo do S3 via endpoint /media/signed/{id}
        const pdfUrl = `${this.publicApiUrl}/contracts/clicksign/signed-pdf/${sig.id}`;
        await this.whatsapp.sendMedia(
          clientPhone,
          'document',
          pdfUrl,
          `📄 Contrato assinado — ${leadName}`,
          instanceName,
        );
        this.logger.log(`[Clicksign] PDF assinado enviado para ${clientPhone}`);
      } catch (e: any) {
        this.logger.warn(`[Clicksign] Falha ao enviar PDF: ${e.message}`);
      }
    }

    // Notificar atendente via WebSocket
    // — emite para a sala da conversa (atendente com a conversa aberta)
    // — E para a sala pessoal do atendente (independente de qual tela está)
    try {
      const eventPayload = {
        conversationId: sig.conversation_id,
        signatureId:    sig.id,
        leadName,
        signedAt:       signedAt.toISOString(),
      };
      this.chatGateway.server
        ?.to(sig.conversation_id)
        .emit('contract:signed', eventPayload);

      if (convo.assigned_user_id) {
        this.chatGateway.server
          ?.to(`user:${convo.assigned_user_id}`)
          .emit('contract:signed', eventPayload);
        this.logger.log(`[Clicksign] contract:signed emitido para sala conv:${sig.conversation_id} e user:${convo.assigned_user_id}`);
      } else {
        this.logger.log(`[Clicksign] contract:signed emitido para sala ${sig.conversation_id} (sem atendente atribuído)`);
      }
    } catch (e: any) {
      this.logger.warn(`[Clicksign] Falha ao emitir WebSocket: ${e.message}`);
    }
  }

  // ── Servir PDF assinado ────────────────────────────────────────────────────
  // Tenta S3 primeiro; se signed_s3_key não existir, baixa do Clicksign
  // on-demand, salva no S3 e atualiza o banco antes de retornar o stream.

  async getSignedPdfStream(signatureId: string) {
    const sig = await this.prisma.contractSignature.findUnique({
      where: { id: signatureId },
    });
    if (!sig) throw new BadRequestException('Assinatura não encontrada');

    // 1. Caminho feliz: PDF já no S3
    if (sig.signed_s3_key) {
      return this.s3.getObjectStream(sig.signed_s3_key);
    }

    // 2. Fallback: baixar do Clicksign agora (webhook pode ter falhado)
    if (!sig.cs_document_key) {
      throw new BadRequestException('PDF assinado não disponível — chave do documento ausente');
    }

    this.logger.log(`[Clicksign] Baixando PDF assinado on-demand para sig ${sig.id} (doc: ${sig.cs_document_key})`);
    let pdfBuffer: Buffer;
    try {
      const { baseUrl, token } = await this.getCfg();

      // Tenta os dois endpoints de download que o Clicksign suporta
      const endpoints = [
        `/api/v1/documents/${sig.cs_document_key}/download`,
        `/api/v1/documents/${sig.cs_document_key}/download?type=signed`,
      ];

      let downloaded = false;
      for (const endpoint of endpoints) {
        try {
          const url = `${baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}access_token=${token}`;
          this.logger.log(`[Clicksign] Tentando download: ${baseUrl}${endpoint}`);
          const res = await fetch(url, { redirect: 'follow' });

          this.logger.log(`[Clicksign] Resposta download: status=${res.status} content-type=${res.headers.get('content-type')}`);

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            this.logger.warn(`[Clicksign] Endpoint ${endpoint} retornou ${res.status}: ${errText}`);
            continue;
          }

          const arrayBuffer = await res.arrayBuffer();
          const buf = Buffer.from(arrayBuffer);

          if (buf.length > 0) {
            pdfBuffer = buf;
            downloaded = true;
            this.logger.log(`[Clicksign] PDF baixado com sucesso (${buf.length} bytes) via ${endpoint}`);
            break;
          }
          this.logger.warn(`[Clicksign] Endpoint ${endpoint} retornou buffer vazio`);
        } catch (innerErr: any) {
          this.logger.warn(`[Clicksign] Erro no endpoint ${endpoint}: ${innerErr.message}`);
        }
      }

      if (!downloaded || !pdfBuffer!) {
        throw new Error('Nenhum endpoint retornou o PDF assinado');
      }
    } catch (e: any) {
      this.logger.error(`[Clicksign] Falha ao baixar PDF on-demand: ${e.message}`);
      throw new BadRequestException(
        'Não foi possível baixar o PDF assinado do Clicksign. ' +
        'Acesse o painel do Clicksign para baixar o documento manualmente.',
      );
    }

    // Salva no S3 e atualiza o banco para downloads futuros
    const s3Key = `contracts-signed/${sig.id}.pdf`;
    try {
      await this.s3.uploadBuffer(s3Key, pdfBuffer, 'application/pdf');
      await this.prisma.contractSignature.update({
        where: { id: sig.id },
        data: { signed_s3_key: s3Key },
      });
      this.logger.log(`[Clicksign] PDF assinado salvo no S3 (on-demand): ${s3Key}`);
      return this.s3.getObjectStream(s3Key);
    } catch (e: any) {
      // Se o upload falhar, retorna o buffer diretamente como stream
      this.logger.warn(`[Clicksign] Falha ao salvar no S3, retornando buffer direto: ${e.message}`);
      const { Readable } = await import('stream');
      const stream = Readable.from(pdfBuffer);
      return { stream, contentType: 'application/pdf', contentLength: pdfBuffer.length };
    }
  }
}
