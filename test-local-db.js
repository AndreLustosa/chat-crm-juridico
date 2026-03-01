const { PrismaClient } = require('@crm/shared');
const path = require('path');
const dotenv = require('dotenv');

// Caminho absoluto para o .env na raiz
const envPath = path.resolve(__dirname, '.env');
console.log('Carregando .env de:', envPath);
dotenv.config({ path: envPath });

console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Definida (mascarada)' : 'NAO DEFINIDA');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function test() {
  console.log('Tentando conectar ao banco...');
  try {
    const start = Date.now();
    await prisma.$connect();
    const end = Date.now();
    console.log(`[SUCESSO] Conectado em ${end - start}ms`);
    
    const count = await prisma.lead.count();
    console.log(`Total de leads no banco: ${count}`);
  } catch (err) {
    console.error('[ERRO] Falha ao conectar:');
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
