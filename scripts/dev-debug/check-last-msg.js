const { PrismaClient } = require('./node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  const lead = await prisma.lead.findFirst({
    where: { phone: '558299130127' },
    include: { conversations: { include: { messages: true } } }
  });
  console.log('Lead and Convos:', JSON.stringify(lead, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
