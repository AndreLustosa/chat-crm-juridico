const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function countNameless() {
  try {
    const total = await prisma.lead.count();
    const nameless = await prisma.lead.count({
      where: {
        name: { contains: 'Contato' }
      }
    });
    
    console.log(`Total de Leads: ${total}`);
    console.log(`Leads identificados como 'Contato X' (sem nome real): ${nameless}`);
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

countNameless();
