const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function check() {
  try {
    const leads = await prisma.lead.findMany({
      take: 20,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        created_at: true
      }
    });

    console.log(`Encontrados ${leads.length} leads recentes:`);
    leads.forEach(l => {
      console.log(`- ${l.name}: ${l.phone} (Criado em: ${l.created_at})`);
    });

    const total = await prisma.lead.count();
    console.log(`Total de leads no banco: ${total}`);
  } catch (error) {
    console.error('Erro ao verificar leads:', error);
  } finally {
    await prisma.$disconnect();
  }
}

check();
