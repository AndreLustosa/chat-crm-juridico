const { PrismaClient } = require('./node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.message.count();
  console.log(`Total messages in DB: ${count}`);
  
  const sample = await prisma.message.findMany({
    take: 5,
    include: { conversation: { include: { lead: true } } }
  });
  console.log('Sample messages:', JSON.stringify(sample, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
