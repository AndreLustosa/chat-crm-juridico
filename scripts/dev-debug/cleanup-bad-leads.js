const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function cleanup() {
  console.log('Iniciando limpeza de leads com IDs internos...');
  
  try {
    const badLeads = await prisma.lead.findMany({
      where: {
        phone: {
          startsWith: 'cmm', // IDs internos da Evolution v2 geralmente começam assim
        },
      },
    });

    console.log(`Encontrados ${badLeads.length} leads inválidos.`);

    if (badLeads.length > 0) {
      // Primeiro temos que deletar as conversas e mensagens associadas para evitar erro de FK
      const leadIds = badLeads.map(l => l.id);
      
      const convs = await prisma.conversation.count({ where: { lead_id: { in: leadIds } } });
      console.log(`Limpando ${convs} conversas associadas...`);
      
      await prisma.conversation.deleteMany({
        where: { lead_id: { in: leadIds } },
      });

      const deleted = await prisma.lead.deleteMany({
        where: { id: { in: leadIds } },
      });

      console.log(`Sucesso: ${deleted.count} leads deletados.`);
    }
  } catch (error) {
    console.error('Erro na limpeza:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
