const { PrismaClient } = require('./node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.conversation.count({
    where: { instance_name: 'whatsapp' }
  });
  console.log(`Total conversations for 'whatsapp': ${count}`);
  
  const sample = await prisma.conversation.findMany({
    where: { instance_name: 'whatsapp' },
    take: 5,
    include: { lead: true }
  });
  console.log('Sample counts/details:', JSON.stringify(sample, null, 2));

  const byInbox = await prisma.conversation.groupBy({
    by: ['inbox_id'],
    where: { instance_name: 'whatsapp' },
    _count: true
  });
  console.log('Grouped by Inbox ID:', JSON.stringify(byInbox, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
