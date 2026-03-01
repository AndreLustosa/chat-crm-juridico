const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function main() {
  try {
    const users = await prisma.user.findMany({
        include: { tenant: true }
    });
    console.log('Usuários encontrados:', JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('ERRO AO BUSCAR USUÁRIOS:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
