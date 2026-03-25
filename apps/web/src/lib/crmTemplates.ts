/** Templates de mensagem sugeridos por etapa do CRM.
 *  Usados no painel lateral do CRM e na barra de resposta rápida no chat. */
export const STAGE_TEMPLATES: Partial<Record<string, { label: string; text: string }>> = {
  QUALIFICANDO:     { label: 'Iniciar triagem', text: 'Olá! Sou do Escritório André Lustosa Advogados. Estamos analisando seu caso. Poderia me contar um pouco mais sobre sua situação para que possamos ajudá-lo melhor?' },
  AGUARDANDO_FORM:  { label: 'Enviar formulário', text: 'Olá! Para darmos continuidade ao seu atendimento, precisamos que você preencha nosso formulário de triagem. Vou te enviar o link agora.' },
  AGUARDANDO_DOCS:  { label: 'Solicitar documentos', text: 'Olá! Para avançarmos com o seu caso, precisamos de alguns documentos: RG ou CPF, comprovante de residência e documentos relacionados ao seu caso. Pode nos enviar por aqui mesmo!' },
  AGUARDANDO_PROC:  { label: 'Atualizar andamento', text: 'Olá! Seu caso está em análise pela nossa equipe. Em breve entraremos em contato com as próximas informações. Qualquer dúvida, estou à disposição!' },
  REUNIAO_AGENDADA: { label: 'Confirmar reunião', text: 'Olá! Sua consulta foi agendada com sucesso. Lembre-se de separar todos os documentos relacionados ao seu caso. Qualquer dúvida antes da reunião, pode me chamar!' },
  FINALIZADO:       { label: 'Agradecer conversão', text: 'Olá! É um prazer tê-lo como cliente do Escritório André Lustosa Advogados. Nossa equipe estará dedicada ao seu caso. Em breve entraremos em contato com os próximos passos!' },
};
