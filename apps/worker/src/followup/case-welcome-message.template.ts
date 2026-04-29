/**
 * Comunicado enviado automaticamente 5 minutos após o cadastro de
 * qualquer processo no CRM. Substitui {{nome}} pelo primeiro nome do
 * cliente. Editar livremente — texto é a fonte de verdade do comunicado.
 */
export function buildCaseWelcomeMessage(firstName: string): string {
  const nome = (firstName || 'cliente').trim();
  return `⚖️ *André Lustosa Advogados — Comunicado Importante*

Olá ${nome}! Aqui é da equipe do escritório André Lustosa Advogados. 😊

Gostaríamos de compartilhar um alerta importante com você.

Infelizmente, tem crescido em todo o Brasil uma prática criminosa conhecida como o *golpe do falso advogado*. Pessoas mal-intencionadas se passam por advogados ou funcionários de escritórios para pedir depósitos, dados bancários ou pagamentos por fora.

🔒 *Para sua segurança, lembre-se:*

✅ Nossos únicos números oficiais são:
• (82) 99913-0127
• (82) 99631-6935
• (82) 99639-0799

✅ Nosso endereço: Rua Francisco Rodrigues Viana, 242 — Baixa Grande, Arapiraca/AL

⚠️ *Nós NUNCA pedimos:*
• Depósitos ou PIX em contas de pessoa física
• Senhas, dados bancários ou códigos por mensagem
• Pagamentos por links desconhecidos

Se alguém entrar em contato se passando pelo nosso escritório por um número diferente dos listados acima, *não faça nenhum pagamento* e nos avise imediatamente por um dos nossos canais oficiais.

Sua segurança é nossa prioridade. Estamos sempre à disposição para qualquer dúvida! 💛

André Lustosa Advogados`;
}
