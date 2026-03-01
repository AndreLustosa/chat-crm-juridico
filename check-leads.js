const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.lead.count();
    console.log(`Total de Leads no Banco: ${count}`);
    if (count > 0) {
      const firstLeads = await prisma.lead.findMany({ take: 5 });
      console.log('Primeiros 5 leads:', JSON.stringify(firstLeads, null, 2));
    }
  } catch (err) {
    console.error('ERRO AO BUSCAR LEADS:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
