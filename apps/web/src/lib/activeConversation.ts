// Ref mutavel compartilhado: ID da conversa atualmente visualizada pelo
// operador. Atualizado pela tela /atendimento a cada mudanca de selectedId
// e lido pelo SocketProvider para silenciar som de nova mensagem quando
// ela chega exatamente na conversa que o operador ja esta lendo com a aba
// em foco — evita interromper a leitura com ding desnecessario.
export const activeConversationRef: { current: string | null } = { current: null };
