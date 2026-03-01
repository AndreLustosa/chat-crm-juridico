const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function checkDuplicates() {
  try {
    const totalLeads = await prisma.lead.count();
    
    const duplicates = await prisma.$queryRaw`
      SELECT phone, COUNT(*) as count 
      FROM "Lead" 
      GROUP BY phone 
      HAVING COUNT(*) > 1
    `;

    console.log(`Total de Leads: ${totalLeads}`);
    console.log(`Telefones duplicados encontrados: ${duplicates.length}`);
    
    if (duplicates.length > 0) {
      duplicates.forEach(d => {
        console.log(`- ${d.phone}: ${d.count} ocorrências`);
      });
    }
  } catch (error) {
    console.error('Erro ao verificar duplicatas:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDuplicates();
