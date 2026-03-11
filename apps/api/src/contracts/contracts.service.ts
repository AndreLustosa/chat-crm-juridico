import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
  BorderStyle, convertInchesToTwip,
} from 'docx';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';

// ─── Meses em português ────────────────────────────────────────────────────────
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const PCT_EXTENSO: Record<number, string> = {
  5: 'cinco', 10: 'dez', 15: 'quinze', 20: 'vinte', 25: 'vinte e cinco',
  30: 'trinta', 35: 'trinta e cinco', 40: 'quarenta',
};

function formatarDataExtenso(ds?: string): string {
  if (!ds) return '____ de ________ de ____';
  const d = new Date(ds + (ds.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return ds;
  return `${d.getDate()} dias do mês de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function dataContrato(): string {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// ─── Tipos de variáveis do contrato ───────────────────────────────────────────

export interface ContratoVariaveis {
  NOME_CONTRATANTE: string;
  NACIONALIDADE: string;
  ESTADO_CIVIL: string;
  DATA_NASCIMENTO: string;
  NOME_MAE: string;
  NOME_PAI: string;
  CPF: string;
  ENDERECO: string;
  BAIRRO: string;
  CEP: string;
  CIDADE_UF: string;
  PERCENTUAL: number;
  PERCENTUAL_EXTENSO: string;
  DESCRICAO_CAUSA: string;
  DATA_CONTRATO: string;
  CIDADE_CONTRATO: string;
}

function variavelVazia(v: string) {
  return !v || v.trim() === '' || v.startsWith('_');
}

// ─── Geração do DOCX ─────────────────────────────────────────────────────────

function buildDocx(v: ContratoVariaveis): Document {
  const pctStr = `${v.PERCENTUAL}% (${v.PERCENTUAL_EXTENSO} por cento)`;
  const causeText = v.DESCRICAO_CAUSA;

  const heading = (text: string) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text, bold: true, size: 24, font: 'Times New Roman' })],
    });

  const clause = (label: string, body: string) =>
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 160, after: 80 },
      children: [
        new TextRun({ text: label + ' – ', bold: true, size: 22, font: 'Times New Roman' }),
        new TextRun({ text: body, size: 22, font: 'Times New Roman' }),
      ],
    });

  const sub = (text: string) =>
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      indent: { left: convertInchesToTwip(0.5) },
      spacing: { before: 80, after: 80 },
      children: [new TextRun({ text, size: 22, font: 'Times New Roman' })],
    });

  const body = (text: string) =>
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 120, after: 120 },
      children: [new TextRun({ text, size: 22, font: 'Times New Roman' })],
    });

  const space = () =>
    new Paragraph({ children: [new TextRun({ text: '', size: 22 })] });

  const sigLine = (label: string) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 280, after: 60 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } },
      children: [new TextRun({ text: label, size: 22, font: 'Times New Roman' })],
    });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: convertInchesToTwip(1.2),
              bottom: convertInchesToTwip(1.2),
              left: convertInchesToTwip(1.4),
              right: convertInchesToTwip(1.2),
            },
          },
        },
        children: [
          heading('CONTRATO DE PRESTAÇÃO DE SERVIÇOS E HONORÁRIOS ADVOCATÍCIOS'),
          space(),
          body(
            `Pelo presente Instrumento Particular, de um lado ${v.NOME_CONTRATANTE.toUpperCase()}, ` +
            `${v.NACIONALIDADE}, ${v.ESTADO_CIVIL}, nascido(a) aos ${v.DATA_NASCIMENTO}, ` +
            `filho(a) de ${v.NOME_MAE} e ${v.NOME_PAI}, inscrito(a) no CPF sob o nº ${v.CPF}, ` +
            `com residência na ${v.ENDERECO}, ${v.BAIRRO}, CEP ${v.CEP}, ${v.CIDADE_UF}, ` +
            `doravante denominado(a) simplesmente CONTRATANTE, e, de outro, ` +
            `ANDRÉ FREIRE LUSTOSA, brasileiro, divorciado, advogado, inscrito na OAB/AL sob o nº 14.209, ` +
            `e GIANNY KARLA OLIVEIRA SILVA, brasileira, solteira, advogada, inscrita na OAB/AL sob o nº 21.897, ` +
            `ambos com escritório profissional na Rua Francisco Rodrigues Viana, nº 242, bairro Baixa Grande, ` +
            `Arapiraca/AL, CEP 57307-260, doravantes denominados simplesmente CONTRATADOS, têm entre si, ` +
            `justo e avençado, o presente Contrato de Prestação de Serviços Advocatícios, regido segundo as ` +
            `cláusulas e condições a seguir pactuadas:`,
          ),
          space(),
          clause(
            'CLÁUSULA 1ª',
            `Os advogados contratados obrigam-se, face ao mandado judicial que lhes foi outorgado, ` +
            `a prestar seus serviços profissionais na defesa dos direitos do contratante ao trâmite ` +
            `e condução do seu ${causeText}.`,
          ),
          sub(
            `Parágrafo único. O presente contrato não engloba recursos em segunda instância no tribunal ` +
            `ou em órgão administrativo, devendo ser celebrado outro contrato caso haja interesse do contratante.`,
          ),
          space(),
          clause(
            'CLÁUSULA 2ª',
            `Em remuneração aos serviços profissionais ora pactuados (honorários), a Contratante pagará ` +
            `a importância de ${pctStr} a ser pago no momento da homologação da ação trabalhista pela CONTRATANTE.`,
          ),
          sub(
            `Parágrafo único – O percentual de ${pctStr} previsto, incidirá sobre todos os valores que o ` +
            `CONTRATANTE vier a receber em decorrência da ${causeText}, incluindo, para todos os fins, ` +
            `quaisquer quantias percebidas a título de seguro-desemprego, por se tratar de benefício ` +
            `diretamente relacionado à rescisão contratual objeto da demanda.`,
          ),
          space(),
          clause(
            'CLÁUSULA 3ª',
            `O total dos honorários poderá ser exigido imediatamente pelo contratado, se houver composição ` +
            `amigável realizada por qualquer dos litigantes, ou ainda, se lhe for cassado o mandato sem culpa.`,
          ),
          space(),
          clause(
            'CLÁUSULA 4ª',
            `As partes contratantes elegem o foro desta cidade para o fim de dirimir qualquer ação oriunda ` +
            `do presente contrato.`,
          ),
          space(),
          body(
            `E para firmeza e como prova de assim haverem contratado, fizeram este instrumento particular, ` +
            `impresso em duas vias de igual teor e forma, assinado pelas partes abaixo, a tudo presentes.`,
          ),
          space(),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 240 },
            children: [
              new TextRun({ text: `${v.CIDADE_CONTRATO}, ${v.DATA_CONTRATO}.`, size: 22, font: 'Times New Roman' }),
            ],
          }),
          sigLine('Contratante'),
          sigLine('Contratado – André Freire Lustosa – OAB/AL 14.209'),
          sigLine('Contratada – Gianny Karla Oliveira Silva – OAB/AL 21.897'),
        ],
      },
    ],
  });
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
    private whatsapp: WhatsappService,
    private chatGateway: ChatGateway,
  ) {}

  // ── 1. Preview: busca dados da conversa e monta variáveis pré-preenchidas ──

  async getPreview(conversationId: string): Promise<{
    variaveis: ContratoVariaveis;
    camposFaltando: string[];
  }> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: { include: { memory: true, ficha_trabalhista: true } } },
    });
    if (!convo?.lead) throw new BadRequestException('Conversa inválida');

    const lead = convo.lead;
    const ficha = (lead.ficha_trabalhista?.data as Record<string, any>) || {};
    const mem = (lead.memory?.facts_json as any) || {};

    const v: ContratoVariaveis = {
      NOME_CONTRATANTE:
        ficha.nome_completo || lead.name || mem?.lead?.full_name || '___________________',
      NACIONALIDADE: ficha.nacionalidade || 'brasileiro(a)',
      ESTADO_CIVIL: ficha.estado_civil || '___________________',
      DATA_NASCIMENTO: formatarDataExtenso(ficha.data_nascimento),
      NOME_MAE: ficha.nome_mae || mem?.lead?.mother_name || '___________________',
      NOME_PAI: ficha.nome_pai || '___________________',
      CPF: ficha.cpf || mem?.lead?.cpf || '___.___.___-__',
      ENDERECO: ficha.endereco || '___________________',
      BAIRRO: ficha.bairro || '___________________',
      CEP: ficha.cep || '__.___-___',
      CIDADE_UF:
        (ficha.cidade || mem?.lead?.city || 'Arapiraca') +
        ' - ' +
        (ficha.estado_uf || mem?.lead?.state || 'AL'),
      PERCENTUAL: 30,
      PERCENTUAL_EXTENSO: 'trinta',
      DESCRICAO_CAUSA:
        ficha.situacao_atual ||
        mem?.case?.subarea ||
        'processo de Reclamação Trabalhista, que tramita no Tribunal Regional do Trabalho da 19ª Região',
      DATA_CONTRATO: dataContrato(),
      CIDADE_CONTRATO: 'Arapiraca - AL',
    };

    const camposFaltando: string[] = [];
    if (variavelVazia(v.NOME_CONTRATANTE)) camposFaltando.push('Nome completo');
    if (variavelVazia(v.ESTADO_CIVIL) || v.ESTADO_CIVIL === '___________________') camposFaltando.push('Estado civil');
    if (v.DATA_NASCIMENTO.startsWith('_')) camposFaltando.push('Data de nascimento');
    if (variavelVazia(v.NOME_MAE) || v.NOME_MAE === '___________________') camposFaltando.push('Nome da mãe');
    if (variavelVazia(v.NOME_PAI) || v.NOME_PAI === '___________________') camposFaltando.push('Nome do pai');
    if (v.CPF === '___.___.___-__') camposFaltando.push('CPF');
    if (variavelVazia(v.ENDERECO) || v.ENDERECO === '___________________') camposFaltando.push('Endereço');
    if (variavelVazia(v.BAIRRO) || v.BAIRRO === '___________________') camposFaltando.push('Bairro');
    if (v.CEP === '__.___-___') camposFaltando.push('CEP');

    return { variaveis: v, camposFaltando };
  }

  // ── 2. Gerar DOCX + upload S3 + enviar via WhatsApp + salvar mensagem ────

  // ── Gera apenas o buffer (para download direto no PC) ─────────────────────

  async generateBuffer(variaveis: ContratoVariaveis): Promise<Buffer> {
    variaveis.PERCENTUAL_EXTENSO =
      PCT_EXTENSO[variaveis.PERCENTUAL] || String(variaveis.PERCENTUAL);
    const doc = buildDocx(variaveis);
    return Packer.toBuffer(doc);
  }

  async generateAndSend(
    conversationId: string,
    variaveis: ContratoVariaveis,
    publicApiUrl: string,
    senderId?: string,
  ): Promise<{ messageId: string; s3Key: string }> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
    if (!convo?.lead) throw new BadRequestException('Conversa inválida');

    // Normalizar percentual extenso
    variaveis.PERCENTUAL_EXTENSO =
      PCT_EXTENSO[variaveis.PERCENTUAL] ||
      `${variaveis.PERCENTUAL}`;

    // 1. Gerar buffer do DOCX
    const doc = buildDocx(variaveis);
    const buffer = await Packer.toBuffer(doc);

    // 2. Criar registro de mensagem para obter ID
    const tempExtId = `out_contrato_${Date.now()}`;
    const clientName = variaveis.NOME_CONTRATANTE.split(' ')[0] || 'cliente';
    const fileName = `Contrato_Trabalhista_${clientName.replace(/\s+/g, '_')}.docx`;

    const msg = await this.prisma.message.create({
      data: {
        conversation_id: convo.id,
        direction: 'out',
        type: 'document',
        text: `📄 Contrato Trabalhista — ${variaveis.NOME_CONTRATANTE}`,
        external_message_id: tempExtId,
        status: 'enviando',
      },
    });

    // 3. Upload para S3
    const s3Key = `contracts/${msg.id}.docx`;
    await this.s3.uploadBuffer(
      s3Key,
      buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    // 4. Criar registro de mídia
    await this.prisma.media.create({
      data: {
        message_id: msg.id,
        s3_key: s3Key,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        original_name: fileName,
      },
    });

    // 5. Montar base64 puro (sem prefixo data URI) para a Evolution API
    const base64Media = buffer.toString('base64');
    this.logger.log(`[CONTRATO] Enviando documento via base64 para ${convo.lead.phone}`);

    // 6. Enviar via WhatsApp como documento
    let sendStatus = 'enviado';
    let externalId = tempExtId;
    try {
      const result = await this.whatsapp.sendMedia(
        convo.lead.phone,
        'document',
        base64Media,
        `📄 Contrato Trabalhista — ${variaveis.NOME_CONTRATANTE}`,
        convo.instance_name || undefined,
        fileName,
      );
      if (result?.statusCode >= 400 || result?.error) {
        this.logger.error(`Evolution API erro contrato: ${JSON.stringify(result)}`);
        sendStatus = 'erro';
      } else {
        externalId = result?.key?.id || tempExtId;
      }
    } catch (e: any) {
      this.logger.error(`Exceção ao enviar contrato: ${e.message}`);
      sendStatus = 'erro';
    }

    // 7. Atualizar status + externalId na mensagem
    await this.prisma.message.update({
      where: { id: msg.id },
      data: { external_message_id: externalId, status: sendStatus },
    });

    // 8. Atualizar conversa + emitir WebSocket
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { last_message_at: new Date() },
    });
    this.chatGateway.emitNewMessage(convo.id, { ...msg, status: sendStatus, external_message_id: externalId });
    this.chatGateway.emitConversationsUpdate(null);

    this.logger.log(`[CONTRATO] Contrato enviado para ${convo.lead.phone} — msg ${msg.id}`);
    return { messageId: msg.id, s3Key };
  }
}
