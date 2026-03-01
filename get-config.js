const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function getConfig() {
  try {
    const keys = ['EVOLUTION_API_URL', 'EVOLUTION_GLOBAL_APIKEY', 'WEBHOOK_URL'];
    const settings = await prisma.globalSetting.findMany({
      where: { key: { in: keys } }
    });

    console.log('--- Configurações no Banco ---');
    settings.forEach(s => {
      console.log(`${s.key}: ${s.value}`);
    });
    
    if (settings.length === 0) {
      console.log('Nenhuma configuração encontrada no banco.');
    }
  } catch (error) {
    console.error('Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getConfig();
