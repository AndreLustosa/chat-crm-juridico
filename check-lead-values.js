const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function check() {
  try {
    const leads = await prisma.lead.findMany({
      where: {
        OR: [
          { name: { contains: 'Fernanda' } },
          { name: { contains: 'Rafael' } },
          { phone: { contains: '+' } },
          { phone: { contains: '(' } }
        ]
      },
      select: {
        id: true,
        name: true,
        phone: true
      }
    });

    console.log(`Leads encontrados (${leads.length}):`);
    leads.forEach(l => {
      console.log(`- ID: ${l.id} | Name: ${l.name} | Phone: "${l.phone}"`);
    });
  } catch (error) {
    console.error('Erro ao verificar leads:', error);
  } finally {
    await prisma.$disconnect();
  }
}

check();
