const { PrismaClient } = require('./node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  const inboxes = await prisma.inbox.findMany({
    include: { _count: { select: { conversations: true } } }
  });
  console.log('Inboxes:', JSON.stringify(inboxes, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
