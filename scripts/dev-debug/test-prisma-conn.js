const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

async function testConnection() {
  console.log('Testando conexao com Banco de Dados via Prisma...');
  
  try {
    // Tenta uma operacao simples
    const result = await prisma.$queryRaw`SELECT 1 as connected`;
    console.log('✅ SUCESSO! Conexao estabelecida com a VPS.');
    console.log('Resultado do teste:', result);
  } catch (error) {
    console.error('❌ ERRO CRITICO de Conexao:', error.message);
    console.error('Detalhes:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
