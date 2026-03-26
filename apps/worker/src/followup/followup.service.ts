import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import OpenAI from 'openai';

@Injectable()
export class FollowupService {
  private readonly logger = new Logger(FollowupService.name);
  private openai: OpenAI;

  constructor(private prisma: PrismaService) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async buildDossie(enrollment: any, step: any, lead: any): Promise<any> {
    // Conversa ativa
    const convo = await this.prisma.conversation.findFirst({
      where: { lead_id: lead.id, status: 'ABERTO' },
      orderBy: { last_message_at: 'desc' },
      include: { assigned_user: { select: { name: true } } },
    });

    // Últimas mensagens (20 para análise mais rica)
    const ultimasMsgs = convo ? await this.prisma.message.findMany({
      where: { conversation_id: convo.id, type: { not: 'note' } },
      orderBy: { created_at: 'desc' }, take: 20,
      select: { direction: true, text: true, created_at: true },
    }) : [];

    // Calcular horário que o lead mais responde (baseado no histórico)
    const horarioResposta = this.calcularHorarioResposta(ultimasMsgs.filter(m => m.direction === 'in'));

    // Calcular tempo médio de resposta
    const tempoMedioResposta = this.calcularTempoMedioResposta(ultimasMsgs);

    // Sentimento geral
    const diasSemContato = convo?.last_message_at
      ? Math.floor((Date.now() - convo.last_message_at.getTime()) / 86400000) : 999;
    const ultimaMsgDirecao = ultimasMsgs[0]?.direction || 'N/A';
    const sentimentoGeral = this.avaliarSentimento(diasSemContato, ultimaMsgDirecao, ultimasMsgs);

    // Processos jurídicos
    const casos = await this.prisma.legalCase.findMany({
      where: { lead_id: lead.id },
      select: { process_number: true, case_type: true, status: true, next_hearing_at: true, legal_area: true },
      take: 5,
    });

    // Verificar inadimplência via honorários
    const honorarios = await this.prisma.caseHonorario.findMany({
      where: { legal_case: { lead_id: lead.id } },
      include: { payments: { where: { status: 'PENDENTE' }, select: { value: true, due_date: true } } },
      take: 5,
    });
    const pagamentosPendentes = honorarios.flatMap(h => h.payments);
    const inadimplente = pagamentosPendentes.some(p => p.due_date && new Date(p.due_date) < new Date());
    const valorDevido = pagamentosPendentes.reduce((sum, p) => sum + (p.value || 0), 0);

    // Advogado responsável
    const advogadoNome = (convo as any)?.assigned_user?.name || 'André Lustosa';

    // Mensagens anteriores desta sequência
    const msgsAnteriores = await this.prisma.followupMessage.findMany({
      where: { enrollment_id: enrollment.id, status: { in: ['ENVIADO', 'APROVADO'] } },
      select: { sent_text: true, generated_text: true, step: { select: { channel: true, position: true } } },
      orderBy: { created_at: 'desc' }, take: 6,
    });

    // Canais já tentados nesta sequência
    const canaisJaTentados = [...new Set(msgsAnteriores.map((m: any) => m.step?.channel).filter(Boolean))];

    const hoje = new Date();
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

    // Limite de chars por canal
    const limiteChars: Record<string, number> = {
      whatsapp: 1500, email: 3000, ligacao: 500,
    };

    return {
      pessoa: {
        id: lead.id, nome: lead.name || 'Cliente', telefone: lead.phone, email: lead.email,
        tipo: casos.length > 0 ? 'cliente' : 'lead', estagio: lead.stage,
        canal_preferido: 'whatsapp', horario_responde_mais: horarioResposta,
        tempo_medio_resposta_horas: tempoMedioResposta, advogado_responsavel: advogadoNome,
        desde: lead.created_at, origem: lead.origin, inadimplente, valor_devido: valorDevido > 0 ? valorDevido : undefined,
        dias_sem_contato: diasSemContato,
      },
      historico: {
        total_msgs: ultimasMsgs.length,
        ultima_msg_resumo: ultimasMsgs[0]?.text?.substring(0, 300) || 'Sem mensagens anteriores',
        ultima_msg_direcao: ultimaMsgDirecao,
        dias_sem_resposta: diasSemContato,
        sentimento_geral: sentimentoGeral,
        ultimas_msgs: ultimasMsgs.slice(0, 10).reverse().map(m => ({
          direcao: m.direction, text: m.text?.substring(0, 400) || '', created_at: m.created_at.toISOString(),
        })),
      },
      processual: casos.length > 0 ? {
        processos: casos.map(c => ({
          numero: c.process_number || 'Sem número', tipo: c.case_type || 'Geral',
          area: (c as any).legal_area || 'Geral', status: c.status || 'Em andamento',
          proxima_data: c.next_hearing_at ? c.next_hearing_at.toLocaleDateString('pt-BR') : undefined,
        })),
        total_encerrados: 0,
      } : undefined,
      financeiro: inadimplente || valorDevido > 0 ? { inadimplente, valor_devido: valorDevido, dias_atraso: inadimplente ? diasSemContato : 0 } : undefined,
      tarefa: {
        sequencia_nome: enrollment.sequence?.name || 'Follow-up',
        categoria: enrollment.sequence?.category || 'LEADS',
        step_position: step.position,
        total_steps: enrollment.sequence?.steps?.length || step.position,
        tentativa_numero: enrollment.current_step,
        objetivo: step.objective, tom: step.tone, canal: step.channel,
        canais_ja_tentados: canaisJaTentados,
        mensagens_anteriores: msgsAnteriores.map((m: any) => m.sent_text || m.generated_text),
      },
      restricoes: {
        nao_mencionar: ['resultados garantidos', 'outros clientes', 'valores de honorários'],
        limite_caracteres: limiteChars[step.channel] || 1500,
        idioma: 'pt-BR',
        regras_oab: true,
      },
      data_hora_atual: hoje.toLocaleString('pt-BR', { timeZone: 'America/Maceio' }),
      dia_semana: diasSemana[hoje.getDay()],
    };
  }

  private calcularHorarioResposta(msgsDosLead: any[]): string {
    if (msgsDosLead.length === 0) return 'horário comercial';
    const horas = msgsDosLead.map(m => new Date(m.created_at).getHours());
    const mediaHora = Math.round(horas.reduce((s, h) => s + h, 0) / horas.length);
    if (mediaHora < 9) return 'madrugada/manhã cedo';
    if (mediaHora < 12) return 'manhã';
    if (mediaHora < 14) return 'meio-dia';
    if (mediaHora < 18) return 'tarde';
    return 'noite';
  }

  private calcularTempoMedioResposta(msgs: any[]): number {
    // Calcula tempo médio entre mensagem enviada e resposta do lead
    let totalMs = 0; let pares = 0;
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].direction === 'in' && msgs[i + 1].direction === 'out') {
        const diff = new Date(msgs[i].created_at).getTime() - new Date(msgs[i + 1].created_at).getTime();
        if (diff > 0 && diff < 72 * 3600000) { totalMs += diff; pares++; }
      }
    }
    return pares > 0 ? Math.round(totalMs / pares / 3600000) : 24;
  }

  private avaliarSentimento(diasSemContato: number, ultimaDirecao: string, msgs: any[]): string {
    if (diasSemContato > 30) return 'frio';
    if (diasSemContato > 14) return 'morno';
    if (ultimaDirecao === 'in') return 'ativo'; // Lead respondeu recentemente
    if (diasSemContato < 3) return 'ativo';
    return 'morno';
  }

  async generateMessage(dossie: any, customPrompt?: string | null): Promise<string> {
    const categoria = dossie.tarefa?.categoria || 'LEADS';
    const canal = dossie.tarefa?.canal || 'whatsapp';
    const tom = dossie.tarefa?.tom || 'amigavel';
    const nome = dossie.pessoa?.nome || 'Cliente';
    const advogado = dossie.pessoa?.advogado_responsavel || 'André Lustosa';
    const escritorio = 'Lustosa Advogados';
    const limiteChars = dossie.restricoes?.limite_caracteres || 1500;

    // Prompts específicos por categoria
    const instrucoesPorCategoria: Record<string, string> = {
      LEADS: `Você está fazendo follow-up de captação. O objetivo é converter o lead em cliente.
- Referencie o que o lead perguntou ou seu caso específico
- Demonstre conhecimento sobre o tipo de situação dele
- Ofereça valor antes de pedir algo
- Termine com CTA claro (agendar consulta, responder pergunta)
- Não pareça vendedor — pareça advogado que se importa`,

      CLIENTS: `Você está mantendo relacionamento com cliente ativo.
- Informe andamento em linguagem simples, sem jargão
- Explique o que isso significa na prática para o cliente
- Transmita confiança e controle sobre a situação
- Pergunte se o cliente tem dúvidas`,

      COBRANCA: `Você está fazendo cobrança de honorários (tentativa ${dossie.tarefa?.tentativa_numero || 1}).
- Tentativa 1: tom amigável, lembrete gentil com dados de pagamento
- Tentativa 2: tom firme mas cordial, ofereça parcelamento
- Tentativa 3+: tom profissional formal, mencione consequências
- SEMPRE inclua opção de PIX ou facilidade de pagamento
- NUNCA ameace na 1ª tentativa`,

      REENGAJAMENTO: `Você está reengajando um lead frio ou ex-cliente.
- NÃO mencione que tentou contato antes e não responderam
- Traga informação nova ou valor (mudança de lei, prazo importante)
- Seja breve e respeitoso
- Dê opção natural de dizer "não tenho interesse no momento"`,
    };

    const instrucaoPorCanal: Record<string, string> = {
      whatsapp: `Canal WhatsApp: seja direto, máx ${Math.min(limiteChars, 1500)} caracteres. Saudação breve → ponto principal → pergunta aberta. Máx 1-2 emojis naturais. Sem "*" ou markdown.`,
      email: `Canal Email: escreva "ASSUNTO: [assunto profissional]" na primeira linha, depois pule linha e escreva o corpo. Parágrafos curtos, profissional. Despedida com nome do escritório. Máx ${Math.min(limiteChars, 3000)} caracteres.`,
      ligacao: `Script de ligação: escreva um roteiro com tópicos principais, perguntas sugeridas, e respostas para objeções comuns. Formato: ABERTURA → OBJETIVO → PERGUNTAS → OBJEÇÕES PREVISTAS → ENCERRAMENTO.`,
    };

    const systemPrompt = `Você é ${advogado}, advogado(a) do escritório ${escritorio}.
Está escrevendo uma mensagem para ${nome} pelo canal ${canal}.

REGRAS ABSOLUTAS — NUNCA QUEBRE ESTAS REGRAS:
1. Nunca revele que é uma IA ou que a mensagem foi gerada automaticamente
2. Use o nome da pessoa de forma natural (não repita a cada frase)
3. Nunca invente fatos sobre processos — use APENAS informações fornecidas no contexto
4. Se não tem certeza de algo, NÃO afirme — seja genérico
5. NUNCA faça promessas sobre resultados de processos ou decisões judiciais
6. NUNCA mencione valores de honorários (a menos que a categoria seja COBRANÇA)
7. NUNCA mencione outros clientes ou processos de terceiros
8. NUNCA use: "venho por meio desta", "nesta oportunidade", "sem mais para o momento"
9. NUNCA mencione que "percebi que você não respondeu"
10. Código de Ética OAB: sem captação ostensiva, sem promessas de resultado

TOM: ${tom === 'amigavel' ? 'amigável e caloroso' : tom === 'profissional' ? 'profissional e claro' : tom === 'empatico' ? 'empático e acolhedor' : 'firme mas cordial'}

${instrucaoPorCanal[canal] || instrucaoPorCanal.whatsapp}

TIPO DE FOLLOW-UP — ${categoria}:
${instrucoesPorCategoria[categoria] || instrucoesPorCategoria.LEADS}

CONTEXTO COMPLETO DO LEAD/CLIENTE:
${JSON.stringify({
  nome: dossie.pessoa?.nome, estagio: dossie.pessoa?.estagio, tipo: dossie.pessoa?.tipo,
  origem: dossie.pessoa?.origem, horario_preferido: dossie.pessoa?.horario_responde_mais,
  inadimplente: dossie.pessoa?.inadimplente, dias_sem_contato: dossie.pessoa?.dias_sem_contato,
  sentimento: dossie.historico?.sentimento_geral,
  ultima_mensagem: dossie.historico?.ultima_msg_resumo,
  ultima_mensagem_foi_do: dossie.historico?.ultima_msg_direcao === 'in' ? 'cliente' : 'escritório',
  processos: dossie.processual?.processos,
  financeiro: dossie.financeiro,
  objetivo: dossie.tarefa?.objetivo,
}, null, 2)}

HISTÓRICO RECENTE (últimas mensagens — para ter contexto do que foi dito):
${(dossie.historico?.ultimas_msgs || []).slice(-6).map((m: any) => `[${m.direcao === 'in' ? 'CLIENTE' : 'ESCRITÓRIO'}]: ${m.text}`).join('\n')}

MENSAGENS ANTERIORES DESTA SEQUÊNCIA — NÃO REPITA ESTRUTURA OU FRASES:
${dossie.tarefa?.mensagens_anteriores?.length > 0
  ? dossie.tarefa.mensagens_anteriores.map((m: string, i: number) => `--- Tentativa ${i + 1} ---\n${m}`).join('\n')
  : 'Esta é a primeira mensagem nesta sequência.'}

${customPrompt ? `\nINSTRUÇÃO ADICIONAL DO ADVOGADO:\n${customPrompt}` : ''}

IMPORTANTE: Gere uma mensagem DIFERENTE das anteriores em estrutura e abordagem.
Gere APENAS o texto da mensagem final, sem introduções, sem "Aqui está a mensagem:" etc.`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }],
        max_tokens: 700,
        temperature: 0.88,
      });
      return completion.choices[0]?.message?.content?.trim() || this.fallbackMessage(nome);
    } catch (e: any) {
      if (e?.status === 429) {
        this.logger.warn('[FOLLOWUP] OpenAI rate limit — aguardando 5s e tentando novamente');
        await new Promise(r => setTimeout(r, 5000));
        return this.generateMessage(dossie, customPrompt);
      }
      this.logger.error(`[FOLLOWUP] Erro OpenAI: ${e.message}`);
      return this.fallbackMessage(nome);
    }
  }

  private fallbackMessage(nome: string): string {
    return `Olá, ${nome}! Estamos aqui para dar continuidade ao seu atendimento. Podemos conversar?`;
  }

  classifyRisk(dossie: any, step: any): 'baixo' | 'medio' | 'alto' {
    let score = 0;
    const tentativa = dossie.tarefa?.tentativa_numero || 1;
    const sentimento = dossie.historico?.sentimento_geral;
    const inadimplente = dossie.pessoa?.inadimplente;
    const categoria = dossie.tarefa?.categoria;
    const diasSemResposta = dossie.historico?.dias_sem_resposta || 0;

    if (sentimento === 'negativo') score += 3;
    if (inadimplente && categoria === 'COBRANCA' && tentativa >= 3) score += 2;
    if (dossie.processual?.processos?.some((p: any) => p.status?.includes('sentença'))) score += 1;
    if (step?.auto_send === false) score += 2; // Step marcado como sempre supervisionado
    if (sentimento === 'frio' && tentativa > 3) score += 2;
    if (diasSemResposta > 60) score += 1;
    if (dossie.tarefa?.tom === 'firme' && tentativa >= 2) score += 1;

    if (score >= 4) return 'alto';
    if (score >= 2) return 'medio';
    return 'baixo';
  }

  // ─── Análise de Resposta (Response Listener) ──────────────────────────────

  async analyzeResponse(text: string, dossie: any): Promise<{
    sentimento: string; intencao: string; urgencia: string;
    requer_humano: boolean; resumo: string; proxima_acao: string;
  }> {
    const prompt = `Analise esta resposta de um lead/cliente jurídico e retorne JSON.

RESPOSTA DO LEAD: "${text}"

CONTEXTO: Lead "${dossie.pessoa?.nome}" no estágio "${dossie.pessoa?.estagio}".

Retorne APENAS este JSON (sem markdown):
{
  "sentimento": "positivo|neutro|negativo",
  "intencao": "quer_contratar|pedindo_informacao|negociando|recusando|pedindo_prazo|insatisfeito|pedindo_atualizacao|confirmando|incerto",
  "urgencia": "alta|media|baixa",
  "requer_humano": true|false,
  "resumo": "Uma frase resumindo a resposta",
  "proxima_acao": "O que fazer a seguir"
}

Considere requer_humano=true se:
- Menciona trocar de advogado ou insatisfação grave
- Assunto sensível (luto, separação, prisão de familiar)
- Negociação de valores ou acordos
- Reclamação de serviço`;

    try {
      const r = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300, temperature: 0.3,
        response_format: { type: 'json_object' },
      });
      const json = JSON.parse(r.choices[0]?.message?.content || '{}');
      return {
        sentimento: json.sentimento || 'neutro',
        intencao: json.intencao || 'incerto',
        urgencia: json.urgencia || 'media',
        requer_humano: json.requer_humano || false,
        resumo: json.resumo || 'Sem resumo',
        proxima_acao: json.proxima_acao || 'Aguardar próximo passo',
      };
    } catch {
      return { sentimento: 'neutro', intencao: 'incerto', urgencia: 'media', requer_humano: false, resumo: 'Sem análise', proxima_acao: 'Revisar manualmente' };
    }
  }
}
